import { z } from "zod";
import { quantitiesSchema } from "./validation";
export const organizerSections = [
  "overview",
  "teams",
  "fixtures",
  "shirts",
  "previews",
  "reviews",
  "plan",
  "brief",
  "settings",
] as const;
export type OrganizerSection = (typeof organizerSections)[number];
const id = z.string().min(1).max(100);
export const agentActionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("teamSizes"), teamId: id, quantities: quantitiesSchema }),
  z.object({ op: z.literal("budget"), amountMinor: z.number().int().min(0).max(100_000_000) }),
  z.object({ op: z.literal("lock"), teamId: id, optionId: id }),
  z.object({ op: z.literal("unlock"), teamId: id }),
  z.object({
    op: z.literal("addTeams"),
    teams: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(80),
          code: z
            .string()
            .trim()
            .min(2)
            .max(4)
            .regex(/^[A-Za-z0-9]+$/),
          quantities: quantitiesSchema.nullable(),
        }),
      )
      .min(1)
      .max(16),
  }),
  z.object({
    op: z.literal("fixtures"),
    pairs: z
      .array(z.object({ teamA: id, teamB: id, label: z.string().trim().min(2).max(80) }))
      .min(1)
      .max(120),
  }),
  z.object({ op: z.literal("roundRobin") }),
  z.object({ op: z.literal("runPlan") }),
  z.object({ op: z.literal("prepareBrief") }),
]);
export type AgentAction = z.infer<typeof agentActionSchema>;
export const agentOutputSchema = z.object({
  intent: z.enum(["guide", "explain", "change"]),
  actions: z.array(agentActionSchema).max(10),
  questions: z.array(z.string().min(1).max(300)).max(5),
  destination: z.enum(organizerSections).nullable(),
  focusTeamId: id.nullable(),
});
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export const agentProposalSchema = z.object({
  kind: z.literal("organizer-agent-v1"),
  actions: z.array(agentActionSchema).min(1).max(10),
  steps: z.array(z.string()),
  destination: z.enum(organizerSections),
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type AssistantSuggestion = {
  id: string;
  label: string;
  prompt: string;
  kind: "guide" | "roundRobin" | "plan" | "explain" | "brief" | "unlock" | "navigate";
  navigation?: AgentNavigation;
};
export type AgentNavigation = {
  tab: OrganizerSection;
  label: string;
  teamId?: string;
  designId?: string;
  fixtureId?: string;
};
export type OrganizerFocus = Pick<AgentNavigation, "teamId" | "designId" | "fixtureId">;
export type AgentReply = {
  message: string;
  facts?: string[];
  navigation?: AgentNavigation;
  proposal?: { id: string; revision: number; steps: string[]; destination: OrganizerSection };
};
