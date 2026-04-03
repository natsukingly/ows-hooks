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

async function main() {
  const tokenId = BigInt(process.env["TEST_TOKEN_ID"] ?? "1");
  console.log("Testing tokenId:", tokenId);
  console.log("ENV AGENT_TOKEN_agent_1:", process.env["AGENT_TOKEN_agent_1"]);

  try {
    const owner = await client.readContract({
      address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      abi: identityAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });
    console.log("Owner:", owner);

    const [count, value, dec] = await client.readContract({
      address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      abi: reputationAbi,
      functionName: "getSummary",
      args: [tokenId, [], "", ""],
    });
    console.log("Reputation:", { count, value, dec });
  } catch (e: any) {
    console.log("Error:", e.message?.slice(0, 200));
  }
}

main();
