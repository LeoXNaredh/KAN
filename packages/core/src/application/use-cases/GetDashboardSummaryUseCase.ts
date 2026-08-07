import type { UserProfilePort } from "../../domain/ports/UserProfilePort";
import type { DashboardSummary } from "../../domain/entities/DashboardSummary";

export class GetDashboardSummaryUseCase {
  constructor(private readonly userProfilePort: UserProfilePort) {}

  execute(userId: string): Promise<DashboardSummary> {
    return this.userProfilePort.getDashboardSummary(userId);
  }
}
