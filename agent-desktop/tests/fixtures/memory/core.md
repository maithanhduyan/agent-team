---
memory_version: 1
updated: 2026-09-01T00:00:00.000Z
count: 10
---

# Core Memory

<!-- fact_0001 -->
## fact_0001: Owner communicates in Vietnamese

- **statement:** The owner communicates with the agent in Vietnamese.
- **provenance:** user_stated
- **importance:** 0.9
- **hot:** true
- **valid_from:** 2026-08-01T08:00:00.000Z
- **valid_to:**
- **source:** telegram:chat:12345
- **supporting_observations:** evt_a1b2c3d4e5f60002 , evt_a1b2c3d4e5f60013 , evt_a1b2c3d4e5f60014
- **observation_count:** 3
- **last_observed:** 2026-08-31T12:00:00.000Z
- **status:** active

<!-- fact_0002 -->
## fact_0002: English for technical documentation

- **statement:** The owner prefers English for technical documentation.
- **provenance:** user_stated
- **importance:** 0.85
- **hot:** true
- **valid_from:** 2026-08-10T08:00:00.000Z
- **valid_to:**
- **source:** telegram:chat:12345
- **supporting_observations:** evt_a1b2c3d4e5f60002 , evt_a1b2c3d4e5f60004
- **observation_count:** 3
- **last_observed:** 2026-08-30T08:00:00.000Z
- **status:** active

<!-- fact_0003 -->
## fact_0003: Laptop uses EFS for user profile

- **statement:** On the owner's laptop, C:\Users\owner uses EFS encryption.
- **provenance:** tool_output
- **importance:** 0.8
- **hot:** true
- **valid_from:** 2026-08-25T09:00:00.000Z
- **valid_to:**
- **source:** tool:sandbox-test:efs-case
- **supporting_observations:** evt_a1b2c3d4e5f60007 , evt_f6a7b8c9d0e10029
- **observation_count:** 3
- **last_observed:** 2026-08-25T09:00:00.000Z
- **status:** active

<!-- fact_0004 -->
## fact_0004: Install script must handle EFS

- **statement:** The install-dsh script must copy files with decrypted content on EFS-encrypted directories.
- **provenance:** tool_output
- **importance:** 0.8
- **hot:** false
- **valid_from:** 2026-08-26T10:00:00.000Z
- **valid_to:**
- **source:** tool:sandbox-test:efs-case
- **supporting_observations:** evt_a1b2c3d4e5f60007 , evt_a1b2c3d4e5f60009 , evt_f6a7b8c9d0e10029
- **observation_count:** 3
- **last_observed:** 2026-08-26T10:00:00.000Z
- **status:** active

<!-- fact_0005 -->
## fact_0005: Owner drinks tea in the morning

- **statement:** The owner drinks tea every morning.
- **provenance:** user_stated
- **importance:** 0.9
- **hot:** true
- **valid_from:** 2026-07-01T07:00:00.000Z
- **valid_to:**
- **source:** telegram:chat:12345
- **supporting_observations:** evt_a1b2c3d4e5f60018 , evt_a1b2c3d4e5f60019
- **observation_count:** 2
- **last_observed:** 2026-07-01T07:05:00.000Z
- **status:** active

<!-- fact_0006 -->
## fact_0006: Owner uses Windows 11

- **statement:** The owner uses a Windows 11 laptop.
- **provenance:** user_stated
- **importance:** 0.7
- **hot:** false
- **valid_from:** 2026-07-15T08:00:00.000Z
- **valid_to:**
- **source:** telegram:chat:12345
- **supporting_observations:** evt_f6a7b8c9d0e10028
- **observation_count:** 1
- **last_observed:** 2026-07-15T08:00:00.000Z
- **status:** active

<!-- fact_0007 -->
## fact_0007: Owner timezone UTC+7 (superseded)

- **statement:** The owner's timezone is UTC+7.
- **provenance:** user_stated
- **importance:** 0.8
- **hot:** false
- **valid_from:** 2026-07-20T08:00:00.000Z
- **valid_to:** 2026-08-29T00:00:00.000Z
- **source:** telegram:chat:12345
- **supporting_observations:** evt_a1b2c3d4e5f60020
- **observation_count:** 3
- **last_observed:** 2026-08-20T08:00:00.000Z
- **status:** superseded

<!-- fact_0008 -->
## fact_0008: Owner used to live in Hanoi (expired)

- **statement:** The owner lived in Hanoi.
- **provenance:** user_stated
- **importance:** 0.5
- **hot:** false
- **valid_from:** 2026-06-01T08:00:00.000Z
- **valid_to:** 2026-08-01T00:00:00.000Z
- **source:** telegram:chat:12345
- **supporting_observations:** evt_f6a7b8c9d0e10031
- **observation_count:** 1
- **last_observed:** 2026-08-01T08:00:00.000Z
- **status:** expired

<!-- fact_0009 -->
## fact_0009: Owner timezone UTC+9 (active)

- **statement:** The owner's timezone is UTC+9.
- **provenance:** user_stated
- **importance:** 0.8
- **hot:** false
- **valid_from:** 2026-08-29T00:00:00.000Z
- **valid_to:**
- **source:** telegram:chat:12345
- **supporting_observations:** evt_a1b2c3d4e5f60024 , evt_a1b2c3d4e5f60020
- **observation_count:** 3
- **last_observed:** 2026-08-31T12:00:00.000Z
- **status:** active

<!-- fact_0010 -->
## fact_0010: Low-importance background fact

- **statement:** The owner's city has a humid climate.
- **provenance:** model_inferred
- **importance:** 0.5
- **hot:** false
- **valid_from:** 2026-08-20T08:00:00.000Z
- **valid_to:**
- **source:** model:reflection
- **supporting_observations:** evt_a1b2c3d4e5f60005
- **observation_count:** 1
- **last_observed:** 2026-08-20T08:00:00.000Z
- **status:** active
