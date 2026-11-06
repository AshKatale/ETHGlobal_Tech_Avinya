import { createConfig, http, injected } from "wagmi";
import { hederaTestnet } from "./chain";

// Import `injected` from "wagmi", not "wagmi/connectors": the connectors barrel pulls in
// optional wallet SDKs that break the Next.js build.
export const wagmiConfig = createConfig({
  chains: [hederaTestnet],
  connectors: [injected()],
  transports: { [hederaTestnet.id]: http() },
  ssr: true,
});
