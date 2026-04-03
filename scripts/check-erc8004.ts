import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const identityAbi = [{
  name: "ownerOf",
  type: "function",
  stateMutability: "view" as const,
  inputs: [{ name: "tokenId", type: "uint256" as const }],
  outputs: [{ name: "", type: "address" as const }],
}] as const;

const reputationAbi = [{
  name: "getSummary",
  type: "function",
  stateMutability: "view" as const,
  inputs: [
    { name: "agentId", type: "uint256" as const },
    { name: "clientAddresses", type: "address[]" as const },
    { name: "tag1", type: "string" as const },
    { name: "tag2", type: "string" as const },
  ],
  outputs: [
    { name: "count", type: "uint64" as const },
    { name: "summaryValue", type: "int128" as const },
    { name: "summaryValueDecimals", type: "uint8" as const },
  ],
}] as const;

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

async function checkAgent(tokenId: bigint) {
  try {
    const owner = await client.readContract({
      address: IDENTITY,
      abi: identityAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });
    console.log(`Token ${tokenId}: registered, owner=${owner}`);

    try {
      const [count, summaryValue, decimals] = await client.readContract({
        address: REPUTATION,
        abi: reputationAbi,
        functionName: "getSummary",
        args: [tokenId, [], "", ""],
      });
      console.log(`  Reputation: count=${count}, value=${summaryValue}, decimals=${decimals}`);
    } catch {
      console.log(`  Reputation: no feedback yet`);
    }
  } catch {
    console.log(`Token ${tokenId}: NOT registered`);
  }
}

async function main() {
  console.log("=== ERC-8004 on Base Sepolia ===\n");
  for (const id of [1n, 2n, 3n, 5n, 10n, 50n, 100n]) {
    await checkAgent(id);
  }
}

main();
