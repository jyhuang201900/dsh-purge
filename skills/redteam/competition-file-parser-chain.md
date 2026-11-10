---
name: competition-file-parser-chain
description: 文件解析专项：追踪上传解析、转换器、压缩包与反序列化链路
whenToUse: 靶子有文件上传/解析（图片、文档、压缩包、反序列化），要打通解析链时加载
---

> 主题：文件解析链（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition File Parser Chain

Use this skill when the hard part is following a file from ingress through every parser, extractor, converter, or deserializer boundary that matters.

## Quick Start

1. Preserve the original upload and every derived artifact separately.
2. Map the chain in order: ingress, temp storage, archive extraction, format conversion, parser call, deserialization, and final consumer.
3. Record filenames, MIME guesses, extensions, temp paths, and parser choices before mutating anything.
4. Separate client-visible validation from backend parser behavior.
5. Reproduce the smallest file-processing chain that yields the decisive branch or artifact.

## Workflow

### 1. Map File Ingress And Derivation

- Record request shape, multipart names, content type, filename, temp paths, upload staging, and storage keys.
- Note every derived artifact: extracted archive member, converted preview, generated thumbnail, temp document, or deserialized object.
- Keep original file and each derivative labeled separately.

### 2. Trace Parser And Conversion Boundaries

- Show which parser, converter, extractor, or deserializer runs at each step.
- Record parser-specific decisions driven by extension, MIME, magic bytes, schema, archive member names, or embedded metadata.
- Distinguish parsing success, preview success, conversion success, and business-logic acceptance.

### 3. Reduce To The Decisive File Chain

- Compress the result to the smallest sequence: upload -> derived artifact -> parser boundary -> resulting effect.
- State clearly whether the decisive weakness lives in archive handling, MIME inference, file conversion, path resolution, or deserialization.
- If the chain becomes mostly a generic async worker problem after enqueue, hand off to the tighter queue or worker skill.

## Read This Reference

- Load `references/file-parser-chain.md` for the ingress checklist, parser checklist, and evidence packaging.

## What To Preserve

- Original uploads, derived files, temp paths, storage keys, parser names, and conversion steps
- The exact boundary where backend behavior diverges from user-visible validation
- One minimal replayable file-processing sequence that reaches the decisive effect

---

## 检查清单与常见坑（上游参考并入）

### file-parser-chain

# File Parser Chain Checklist

## First Pass

- Upload request shape, field names, content type, filename, extension, magic bytes, temp storage
- Archive members, conversion outputs, previews, thumbnails, extracted docs, serialized objects
- Final consumers: parser, converter, renderer, importer, deserializer, worker

## Chain To Reconstruct

1. File ingress accepted
2. Temp or staged artifact created
3. Extraction or conversion performed
4. Parser or deserializer invoked
5. Business-logic effect or artifact produced

## Evidence To Keep Together

- Ingress side: request, filename, MIME, temp path, storage key
- Parser side: tool or library invoked, branch condition, derived artifact, parser choice
- Effect side: rendered output, parsed object, backend branch, worker task, or privilege-bearing result

## Common Pitfalls

- Looking only at the original upload and ignoring derived intermediates
- Treating MIME or extension checks as proof of backend parser choice
- Mixing archive, preview, and deserialization stages without preserving each boundary separately
