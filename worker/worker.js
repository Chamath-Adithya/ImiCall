/** Protocol v1 is retired: it accepted unauthenticated signaling.
 * Use server/signaling.js for protocol v2. Keep the export for DO migration compatibility.
 */
export class RoomDurableObject {
  async fetch() { return new Response('Legacy signaling retired. Deploy the protocol v2 Node server.', { status: 410 }); }
}
export default {
  async fetch() { return new Response('Legacy signaling retired. Deploy the protocol v2 Node server.', { status: 410 }); }
};
