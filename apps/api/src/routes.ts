import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AppService } from "./service.js";

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly service: AppService) {}

  @Get("health")
  health() {
    return { ok: true, service: "powerflex-csi-intelligence-api" };
  }

  @Get("versions")
  versions(@Query() query: Record<string, string>) {
    return this.service.versions(query);
  }

  @Get("compatibility")
  compatibility(@Query() query: Record<string, string>) {
    return this.service.compatibility(query);
  }

  @Get("matrix")
  matrix(@Query() query: Record<string, string>) {
    return this.service.matrix(query);
  }

  @Get("bugs")
  bugs(@Query() query: Record<string, string>) {
    return this.service.bugs(query);
  }

  @Get("bugs/:version")
  bugsForVersion(@Param("version") version: string, @Query() query: Record<string, string>) {
    return this.service.bugs({ ...query, version });
  }

  @Get("features")
  features(@Query() query: Record<string, string>) {
    return this.service.features(query);
  }

  @Get("csi-versions")
  csiVersions() {
    return this.service.csiVersions();
  }

  @Get("known-issues")
  knownIssues(@Query() query: Record<string, string>) {
    return this.service.knownIssues(query);
  }

  @Get("recommendations")
  recommendations(@Query() query: Record<string, string>) {
    return this.service.recommendations(query);
  }

  @Get("upgrade-path")
  upgradePath(@Query("from") from: string, @Query("to") to: string) {
    return this.service.upgradePath(from, to);
  }

  @Post("webhooks/github")
  async githubWebhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-event") event: string | undefined,
    @Body() body: unknown
  ) {
    if (!this.service.verifyGithubSignature(request.rawBody ?? Buffer.from(JSON.stringify(body)), signature)) {
      throw new UnauthorizedException("Invalid GitHub webhook signature");
    }
    return this.service.enqueueGithubWebhook(event ?? "unknown", body);
  }
}
