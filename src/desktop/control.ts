import { z } from "zod";

export const shutdownRequestSchema = z
  .object({ control: z.literal("shutdown"), id: z.string().uuid() })
  .strict();
export const shutdownAckSchema = z
  .object({
    control: z.literal("shutdownAck"),
    id: z.string().uuid(),
    clean: z.boolean(),
  })
  .strict();
