import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const config = app.get(ConfigService);
  const port = Number(config.get("API_PORT", "4310"));
  await app.listen(port, "127.0.0.1");
  console.log(`Workflow API listening on http://127.0.0.1:${port}`);
}

void bootstrap();
