/**
 * agent-desktop — memory foundation public API (T03 writers + T04 tools
 * + T05 consolidation).
 *
 * - L2 append-only writer (`sessions.jsonl`): `SessionsWriter`
 * - L3 fact-block writer (`core.md`): `CoreWriter`
 * - Schema validation: `validateL2Record`, `validateFactBlockMetadata`
 * - Injection-pattern quarantine: `scanForInjection`, `DEFAULT_INJECTION_PATTERNS`
 * - SEC-MEM-01 render envelope: `wrapMemoryBlock`, `renderHotFacts`,
 *   `renderSearchResults`, `renderGrepMatches`
 * - Retrieval scoring (α·sim + β·recency + γ·importance): `retrieval.ts`
 * - `search_memory` tool: `searchMemory` (spec §7.1)
 * - `grep_logs` tool: `grepLogs` (spec §7.2)
 * - Hot-fact injection: `loadHotFacts`, `injectHotFacts` (spec §6.3)
 * - SEC-MEM-02 prompt guidance: `buildMemorySystemPrompt` (spec §7.3)
 * - Agentic retrieval budget: `ToolCallBudget`
 * - Multi-model judge panel (Q5): `LLMProvider`, providers, `judgeGate`,
 *   `buildPanelFromConfig` (spec §9)
 * - Cost caps (per model, monthly): `CostTracker` (spec §9.5, SEC-COST-01)
 * - Consolidation job (T05): `runConsolidationJob`, `runConsolidation`,
 *   `applyConflict`, `applyDecay`, `reflect`, `verifier` (spec §8–§10)
 * - Config: `loadMemoryConfig`
 * - Telegram bridge (T08): `loadTelegramConfig`, `TelegramBridge`,
 *   `HttpTelegramTransport`, `SandboxTelegramTransport`, chat commands
 *   (search/grep/hot/spend/help via SEC-MEM-01), consolidation
 *   notifications (graduation/decay/supersede + spend report SEC-COST-02)
 */

export {
    SessionsWriter,
    toIsoUtc,
    type AppendResult,
    type SessionsWriterOptions,
} from './sessions-writer.js';

export {
    CoreWriter,
    parseCoreMd,
    serializeCoreMd,
    validateFactBlock,
    nextFactNumber,
    formatFactId,
    ConsolidationOnlyError,
    FactBlockError,
    type ConsolidationContext,
    type CoreWriterOptions,
    type NewFactBlock,
} from './core-writer.js';

export {
    validateL2Record,
    validateFactBlockMetadata,
    type ValidationResult,
} from './schema.js';

export {
    DEFAULT_INJECTION_PATTERNS,
    scanForInjection,
    findInjectionPattern,
    recordText,
    type InjectionScanResult,
} from './injection.js';

export {
    MemoryConfigError,
    loadMemoryConfig,
    parseRotateMb,
    parsePatternList,
    parseHotImportance,
    parseHotMax,
    parseMaxToolCallsPerTurn,
    parseGraduationN,
    parseDecayDays,
    parseVerifyMinOverlap,
    parseConsolidateEveryMin,
    parseConflictOverlap,
    parseJudgePanelModels,
    parseJudgeConsensus,
    parseJudgeMaxModelsPerCall,
    parseJudgeTimeoutS,
    parseJudgeCapUsd,
    type MemoryConfig,
    type JudgeCaps,
} from './config.js';

export {
    tokenize,
    jaccardSimilarity,
    recencyScore,
    retrievalScore,
    parseRetrievalWeights,
    parseHalfLifeDays,
    DEFAULT_ALPHA,
    DEFAULT_BETA,
    DEFAULT_GAMMA,
    DEFAULT_HALF_LIFE_DAYS,
    RetrievalConfigError,
    type RetrievalWeights,
    type SimilarityFn,
} from './retrieval.js';

export {
    searchMemory,
    validateSearchParams,
    isActiveAt,
    isSearchableL2Record,
    l2Text,
    factText,
    SearchMemoryError,
    DEFAULT_TOP_K,
    DEFAULT_MIN_SCORE,
    MIN_TOP_K,
    MAX_TOP_K,
    SEARCH_LAYERS,
    type SearchMemoryParams,
    type SearchMemoryResult,
    type SearchMemoryMeta,
    type SearchMemoryOutput,
    type SearchMemoryOptions,
    type SearchLayer,
} from './search-memory.js';

export {
    grepLogs,
    validateGrepParams,
    re2SafetyError,
    listMemoryFiles,
    listRunLogFiles,
    lineTimestamp,
    GrepLogsError,
    DEFAULT_CONTEXT_LINES,
    DEFAULT_LIMIT,
    MAX_CONTEXT_LINES,
    MAX_LIMIT,
    type GrepLogsParams,
    type GrepMatch,
    type GrepLogsMeta,
    type GrepLogsOutput,
    type GrepLogsOptions,
    type GrepFiles,
} from './grep-logs.js';

export {
    loadHotFacts,
    injectHotFacts,
    projectDay30Decay,
    DEFAULT_HOT_IMPORTANCE,
    DEFAULT_HOT_MAX,
    DEFAULT_DECAY_DAYS,
    DEFAULT_DECAY_FLOOR,
    type HotFact,
    type HotFactsOptions,
    type HotFactsInjection,
    type DecayProjection,
} from './hot-facts.js';

export {
    MEMORY_TRUST_GUIDANCE,
    AGENTIC_RETRIEVAL_PROTOCOL,
    buildMemorySystemPrompt,
} from './prompt.js';

export {
    ToolCallBudget,
    ToolCallBudgetExceededError,
    DEFAULT_MAX_TOOL_CALLS_PER_TURN,
} from './tool-budget.js';

export {
    MEMORY_START,
    MEMORY_END,
    DATA_NOT_INSTRUCTIONS_NOTE,
    wrapMemoryBlock,
    renderHotFacts,
    renderSearchResults,
    renderGrepMatches,
    type HotFactRenderInput,
    type SearchResultRenderInput,
    type GrepMatchRenderInput,
} from './render.js';

export {
    PROVENANCE_VALUES,
    SOURCE_KIND_VALUES,
    RECORD_TYPE_VALUES,
    FACT_STATUS_VALUES,
} from './types.js';

export {
    // Provider abstraction (spec §9.2, Q5 — ADR-008/ADR-010)
    DeepSeekProvider,
    Gpt4Provider,
    Gemini25ProProvider,
    registerProvider,
    getProvider,
    listProviders,
    clearProviders,
    defaultProviders,
    buildPanelFromConfig,
    completionCostUsd,
    PRICE_TABLE,
    type LLMProvider,
    type JudgeModelName,
    type ProviderOptions,
    type PriceTable,
} from './llm-provider.js';

export {
    CostTracker,
    monthKeyOf,
    DEFAULT_JUDGE_CAPS,
    type CostTrackerOptions,
    type ProviderCostState,
    type CostMonthFile,
} from './costs.js';

export {
    // Judge gate (spec §9, ADR-008)
    judgeGate,
    validateVerdict,
    parseVerdictText,
    buildJudgePrompt,
    resolvePanel,
    JUDGE_RUBRIC,
    factStatement,
    type JudgeGateInput,
    type JudgeGateResult,
    type JudgeVerdict,
    type VerdictValue,
    type VerdictValidation,
    type CandidateInput,
    type FactLike,
    type SupportingObservation,
    type JudgeConfig,
} from './judge.js';

export {
    // Reflection (spec §8.3)
    reflect,
    validateReflection,
    parseReflectionText,
    buildReflectPrompt,
    ReflectionError,
    type ReflectionLesson,
    type ReflectOptions,
} from './reflect.js';

export {
    // Verifier (spec §10.5)
    verifyCandidate,
    findConflictingFacts,
    statementOverlap,
    DEFAULT_CONFLICT_OVERLAP,
    type VerifierInput,
    type VerifierResult,
    type VerifierJudge,
} from './verifier.js';

export {
    // Consolidation job (spec §8, T05)
    runConsolidationJob,
    runConsolidation,
    judge,
    applyConflict,
    applyDecay,
    consolidate,
    run,
    normalizeConsolidationConfig,
    loadCursor,
    saveCursor,
    recordsSince,
    cursorAfter,
    cursorFilePath,
    clusterObservations,
    observationText,
    buildGraduationBlock,
    consolidationDue,
    type RunConsolidationInput,
    type RunConsolidationResult,
    type ApplyConflictInput,
    type ApplyConflictResult,
    type ApplyDecayInput,
    type ApplyDecayResult,
    type ConsolidationConfig,
    type ConsolidationConfigInput,
    type ConsolidationCursor,
    type ConsolidationJobOptions,
    type ConsolidationJobResult,
} from './consolidation.js';

export {
    // Secret redaction (SEC-LOG-01, ADR-010)
    redactSecrets,
    redactJsonValue,
} from './redact.js';

export {
    // Telegram bridge (T08 — plan #22 Q1/R7, sandbox-first)
    TelegramConfigError,
    loadTelegramConfig,
    parseChatIds,
    parsePollIntervalMs,
    parseTimeoutS,
    parseMaxMessageLength,
    type TelegramConfig,
} from './telegram/config.js';

export {
    HttpTelegramTransport,
    SandboxTelegramTransport,
    truncateMessage,
    type TelegramTransport,
    type TelegramUpdate,
    type TelegramOutbound,
    type HttpTelegramTransportOptions,
    type SandboxTelegramTransportOptions,
} from './telegram/transport.js';

export {
    TelegramBridge,
    type TelegramBridgeOptions,
    type CommandOutcome,
} from './telegram/bridge.js';

export {
    buildConsolidationNotification,
    buildConsolidationErrorNotification,
    type ConsolidationNotificationOptions,
    type TelegramEnvironment,
} from './telegram/notify.js';

export {
    parseMemoryCommand,
    executeMemoryCommand,
    memoryHelpText,
    formatSpendReport,
    type MemoryCommand,
    type MemoryCommandName,
    type MemoryCommandDeps,
} from './telegram/commands.js';

export type {
    ISOTimestamp,
    Provenance,
    SourceKind,
    Source,
    L2RecordType,
    ObservationKind,
    RecordContent,
    L2Record,
    FactStatus,
    FactBlock,
    CoreMdHeader,
    CoreMdDocument,
    ConsolidationRunStatus,
} from './types.js';
