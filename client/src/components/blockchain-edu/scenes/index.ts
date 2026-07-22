// 씬 레지스트리 — sceneId → 컴포넌트. ChapterShell 스테이지가 현재 스텝의 sceneId 로 조회.
import type { ComponentType } from "react";
import { Ch1Toggle, Ch1Spectrum } from "./Ch1";
import { Ch2LockMint } from "./Ch2";
import { Ch3Sequencer, Ch3Compression, Ch3BlobTimeline, Ch3BlobFloor } from "./Ch3";

export const SCENES: Record<string, ComponentType> = {
  "ch1-toggle": Ch1Toggle,
  "ch1-spectrum": Ch1Spectrum,
  "ch2-lockmint": Ch2LockMint,
  "ch3-sequencer": Ch3Sequencer,
  "ch3-compression": Ch3Compression,
  "ch3-blobtimeline": Ch3BlobTimeline,
  "ch3-blobfloor": Ch3BlobFloor,
};
