/**
 * agent-desktop — core memory module (T03) public API.
 *
 * - L2 append-only writer (`sessions.jsonl`): `SessionsWriter`
 * - L3 fact-block writer (`core.md`): `CoreWriter`
 * - Schema validation: `validateL2Record`, `validateFactBlockMetadata`
 * - Injection-pattern quarantine: `scanForInjection`, `DEFAULT_INJECTION_PATTERNS`
 * - SEC-MEM-01 render envelope: `wrapMemoryBlock`, `renderHotFacts`,
 *   `renderSearchResults`, `renderGrepMatches`
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
    type MemoryConfig,
} from './config.js';

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
