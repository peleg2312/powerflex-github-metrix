import { Module } from "@nestjs/common";
import { AppController } from "./routes.js";
import { AppService } from "./service.js";

@Module({
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
