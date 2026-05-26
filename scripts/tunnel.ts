/**
 * Persistent tunnel — auto-reconnects on failure.
 * Run: npx tsx scripts/tunnel.ts
 */
import localtunnel from "localtunnel";

async function start() {
  while (true) {
    try {
      const tunnel = await localtunnel({ port: 3456 });
      const url = tunnel.url;
      console.log(`Tunnel: ${url}`);
      console.log(`Webhook: ${url}/api/whatsapp/webhook`);

      tunnel.on("close", () => {
        console.log("Tunnel closed, reconnecting...");
      });

      // Wait until it dies, then reconnect
      await new Promise<void>((resolve) => {
        tunnel.on("close", resolve);
        tunnel.on("error", resolve);
      });
    } catch (e) {
      console.error("Tunnel error:", e);
    }
    // Wait 3 seconds before retrying
    await new Promise((r) => setTimeout(r, 3000));
  }
}

start();
