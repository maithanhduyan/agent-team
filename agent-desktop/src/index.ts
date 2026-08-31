/**
 * agent-desktop — memory foundation public API (T03 writers + T04 tools).
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
 * - Config: `loadMemoryConfig`
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
    loadMemoryConfig,
    parseRotateMb,
    parsePatternList,
    parseHotImportance,
    parseHotMax,
    parseMaxToolCallsPerTurn,
    type MemoryConfig,
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
    DEFAULT_HOT_IMPORTANCE,
    DEFAULT_HOT_MAX,
    type HotFact,
    type HotFactsOptions,
    type HotFactsInjection,
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
} from './types.js';

export {
    PROVENANCE_VALUES,
    SOURCE_KIND_VALUES,
    RECORD_TYPE_VALUES,
    FACT_STATUS_VALUES,
} from './types.js';
