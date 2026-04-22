const N8N_URL = process.env.N8N_WEBHOOK_URL ?? 'http://n8n:5678/webhook';

export async function callWebhook(endpoint: string, body: unknown): Promise<void> {
  try {
    await fetch(`${N8N_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fire-and-forget — log but don't throw
    console.error(`Webhook ${endpoint} failed (non-blocking)`);
  }
}
