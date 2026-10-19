import { Controller, Get } from '@nestjs/common';
import { Public } from '@timonics/auth-guard';

@Controller('v1/health')
export class HealthController {
  /**
   * Liveness/readiness probe for load balancers — public by design
   * (the global JwtAuthGuard would otherwise 401 the LB).
   */
  @Public()
  @Get()
  public getStatus(): { status: string } {
    return { status: 'ok' };
  }
}
