export const eventJoinId = (slotId: string) => `event:join:${slotId}`;
export const eventLeaveId = (eventId: string) => `event:leave:${eventId}`;
export const eventCopyId = (eventId: string) => `event:copy:${eventId}`;
export const lootBidId = (itemId: string) => `loot:bid:${itemId}`;

export const parseCustomId = (customId: string) => {
  const [scope, action, id] = customId.split(":");
  return { scope, action, id };
};
