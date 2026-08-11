export type LootEligibility =
  | "ALLOWED"
  | "LOGIN_REQUIRED"
  | "PROFILE_UNAVAILABLE"
  | "NOT_PARTICIPANT"
  | "POOL_DRAWN";

export const lootEligibility = (input: {
  isLoggedIn: boolean;
  hasActiveGuildProfile: boolean;
  isParticipant: boolean;
  isPoolDrawn: boolean;
}): LootEligibility => {
  if (!input.isLoggedIn) {
    return "LOGIN_REQUIRED";
  }

  if (!input.hasActiveGuildProfile) {
    return "PROFILE_UNAVAILABLE";
  }

  if (input.isPoolDrawn) {
    return "POOL_DRAWN";
  }

  if (!input.isParticipant) {
    return "NOT_PARTICIPANT";
  }

  return "ALLOWED";
};
