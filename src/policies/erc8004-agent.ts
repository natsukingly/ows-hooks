import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import type { Policy, PolicyContext, PolicyResult, ChainResults } from "../types.js";

// ── ERC-8004 contract addresses (Base Sepolia) ──
const IDENTITY_REGISTRY: Address =
  (process.env["ERC8004_IDENTITY_REGISTRY"] as Address) ??
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const REPUTATION_REGISTRY: Address =
  (process.env["ERC8004_REPUTATION_REGISTRY"] as Address) ??
  "0x8004B663056A597Dffe9eCcC1965A193B7388713";

// ── ABI (required functions only) ──
const identityAbi = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const getClientsAbi = [
  {
    name: "getClients",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

const reputationAbi = [
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

// ── Configuration ──
function useMock(): boolean {
  return process.env["ERC8004_MOCK"] === "true";
}

const MIN_REPUTATION = BigInt(process.env["ERC8004_MIN_REPUTATION"] ?? "50");

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env["BASE_SEPOLIA_RPC_URL"]),
});

// ── Mock ──
function mockGetReputation(agentId: string): { registered: boolean; reputation: bigint; feedbackCount: bigint } {
  if (agentId.includes("trusted")) {
    return { registered: true, reputation: BigInt(90), feedbackCount: BigInt(15) };
  }
  if (agentId.includes("mid")) {
    return { registered: true, reputation: BigInt(60), feedbackCount: BigInt(5) };
  }
  if (agentId.includes("new")) {
    return { registered: true, reputation: BigInt(20), feedbackCount: BigInt(1) };
  }
  return { registered: false, reputation: BigInt(0), feedbackCount: BigInt(0) };
}

// ── On-chain query ──
async function getOnChainData(
  agentTokenId: bigint,
): Promise<{ registered: boolean; reputation: bigint; feedbackCount: bigint }> {
  // 1. Verify registration in Identity Registry
  try {
    await client.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: "ownerOf",
      args: [agentTokenId],
    });
  } catch {
    // ownerOf revert → not registered
    return { registered: false, reputation: 0n, feedbackCount: 0n };
  }

  // 2. Retrieve feedback summary from Reputation Registry
  //    Fetch actual client addresses via getClients, then call getSummary
  try {
    const clients = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: getClientsAbi,
      functionName: "getClients",
      args: [agentTokenId],
    });

    if (clients.length === 0) {
      // Registered but no feedback → reputation 0
      return { registered: true, reputation: 0n, feedbackCount: 0n };
    }

    const [count, summaryValue, _decimals] = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [agentTokenId, clients, "", ""],
    });

    const reputation = summaryValue > 0n ? summaryValue : 0n;
    return { registered: true, reputation, feedbackCount: BigInt(count) };
  } catch {
    // Even if reputation retrieval fails, registration is confirmed → treat as reputation 0
    return { registered: true, reputation: 0n, feedbackCount: 0n };
  }
}

// ── Policy ──
export const erc8004Agent: Policy = {
  name: "erc8004-agent",

  async evaluate(ctx: PolicyContext, _chainResults: ChainResults): Promise<PolicyResult> {
    const agentId = ctx.api_key_id;

    let registered: boolean;
    let reputation: bigint;
    let feedbackCount: bigint;

    if (useMock()) {
      ({ registered, reputation, feedbackCount } = mockGetReputation(agentId));
    } else {
      // On-chain mode: interpret api_key_id as the agent's ERC-721 tokenId
      // In production, manage the api_key_id → tokenId mapping via a config file
      const tokenId = BigInt(process.env[`AGENT_TOKEN_${agentId}`] ?? "0");
      ({ registered, reputation, feedbackCount } = await getOnChainData(tokenId));
    }

    if (!registered) {
      return {
        allow: false,
        reason: `Agent ${agentId} is not registered in ERC-8004 Identity Registry`,
      };
    }

    if (reputation < MIN_REPUTATION) {
      return {
        allow: false,
        reason: `Agent ${agentId} reputation (${reputation}) is below minimum (${MIN_REPUTATION})`,
      } satisfies PolicyResult;
    }

    const result: PolicyResult & { metadata?: Record<string, unknown> } = {
      allow: true,
      metadata: {
        reputation: Number(reputation),
        feedbackCount: Number(feedbackCount),
      },
    };
    return result;
  },
};
