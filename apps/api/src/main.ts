import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import cors from "cors";
import { AppModule } from "./module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(
    json({
      limit: "2mb",
      verify: (req: any, _res, buffer) => {
        req.rawBody = buffer;
      }
    })
  );
  app.use(cors({ origin: true }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`PowerFlex intelligence API listening on :${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
