// STGB-ANCHOR-001 — map a network token to its XRPL explorer host. The two production
// networks have distinct explorers (testnet.xrpl.org vs livenet.xrpl.org). An unknown
// network derives a host from the sanitized token. It never falls back to testnet.
const EXPLORER_HOSTS = {
  mainnet: "livenet.xrpl.org",
  testnet: "testnet.xrpl.org",
  devnet: "devnet.xrpl.org",
};

export function explorerHostFor(network) {
  const key = String(network || "").toLowerCase();
  if (EXPLORER_HOSTS[key]) return EXPLORER_HOSTS[key];
  const safe = key.replace(/[^a-z0-9-]/g, "") || "unknown";
  return `${safe}.xrpl.org`;
}

export function explorerTxUri(network, txHash) {
  return `https://${explorerHostFor(network)}/transactions/${txHash}`;
}
