import type { DashboardSummary } from "../entities/DashboardSummary";
import type { UserProfile } from "../entities/UserProfile";

export interface UserProfilePort {
  getProfile(userId: string): Promise<UserProfile | undefined>;
  updateDisplayName(userId: string, displayName: string): Promise<UserProfile>;
  getDashboardSummary(userId: string): Promise<DashboardSummary>;
}
