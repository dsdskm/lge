import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { findProjectRoot } from "./project-root.js";
import { PortalModule } from "./portal/portal.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(findProjectRoot(), ".env"),
    }),
    PortalModule,
  ],
})
export class AppModule {}
