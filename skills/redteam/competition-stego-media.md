---
name: competition-stego-media
description: 隐写专项：检查媒体通道、尾部附加数据与隐藏载荷边界
whenToUse: 拿到图片/音视频等媒体，怀疑有隐藏载荷时加载
---

> 主题：隐写与媒体载体（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Stego Media

Use this skill when the challenge lives inside a media container, hidden channel, or appended payload rather than a conventional crypto blob.

## Quick Start

1. Confirm the real container type, dimensions, duration, codec, and chunk layout before guessing a hidden layer.
2. Check metadata, thumbnails, sidecar files, and appended trailers before deeper signal-domain work.
3. Rank candidate channels by evidence: alpha, palette, LSB, transform-domain residue, frame order, or container slack.
4. Preserve each extracted layer separately so the transform chain stays reproducible.
5. Stop when the hidden payload is reproduced, not merely suspected.

## Workflow

### 1. Establish Container Truth

- Inspect headers, chunk tables, EXIF or document metadata, container indexes, thumbnails, and file size anomalies.
- Compare declared format against observed structure to catch polyglots, appended archives, or malformed trailers.
- Record exact offsets, frame numbers, or channel boundaries that look promising.

### 2. Inspect Candidate Channels

- Check alpha, palette order, RGB or YUV planes, LSBs, spectrogram features, document object streams, or video frame deltas.
- Prefer evidence-driven attempts over brute forcing every transform.
- Note whether the payload is plain bytes, another media layer, compressed data, or an encrypted blob.

### 3. Reconstruct The Hidden Payload Path

- Keep the chain in order: container -> channel or carrier -> extraction -> decompression or decode -> final parse.
- Separate extraction success from final interpretation; a channel hit is not the same as artifact recovery.
- If the problem becomes primarily about cryptography after extraction, hand off to the broader crypto skill.

## Read This Reference

- Load `references/stego-media.md` for the media checklist, channel ranking guide, and evidence packaging.

## What To Preserve

- File structure facts: offsets, chunks, frame numbers, stream names, metadata keys, and trailer size
- Intermediate extractions and the exact command or transform used to produce them
- The final recovered payload and the channel that produced it

---

## 检查清单与常见坑（上游参考并入）

### stego-media

###### Stego Media Checklist

###### First Pass

- Verify magic bytes, headers, chunk or atom layout, dimensions, duration, sample rate, and metadata
- Check for appended data, malformed trailers, duplicate thumbnails, embedded archives, or sidecar files
- Record entropy shifts, unexpected padding, or container slack regions

###### Candidate Channels

1. Alpha or palette anomalies
2. LSBs in image or audio samples
3. Frame-order or delta anomalies in video
4. Document object streams, attachments, or hidden layers
5. Transform-domain residue, QR fragments, or watermark-style carriers

###### Evidence Packaging

- Keep one compact block for offsets, channels, and extraction commands
- Keep each extracted stage as a separate file
- Note clearly whether the result is plaintext, another container, compressed data, or ciphertext

###### Common Pitfalls

- Jumping into brute force before checking trailers and metadata
- Mixing several partial decode attempts without tracking which channel produced which bytes
- Treating a suspicious pattern as success without reproducing the hidden payload

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-request-normalization-smuggling`、`competition-runtime-routing`、`competition-supply-chain`、`competition-template-render-path`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
