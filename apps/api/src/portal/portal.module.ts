import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PortalController } from "./portal.controller.js";
import { PortalService } from "./portal.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
