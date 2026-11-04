# 0001: Record design decisions in this folder

**Status:** Accepted  
**Date:** 2026-11-04

## What we need to decide

Imprint will be reviewed by people outside the team: classification practitioners, security assessors and, later, agencies deciding whether to deploy it. Many of its design choices exist for policy or security reasons that are not visible in the code. For example, "why does the app refuse to call a valid signature *approved*?" has an answer in the requirements, not in the code.

## What we chose

Keep short, numbered decision records in `docs/decisions/`, using the template in `0000-template.md`. Accepted records are never rewritten; a later record supersedes them.

## What this means

Every pull request that makes or reverses a design choice adds or updates a record. Reviewers can ask "where is the record?" when one is missing.
