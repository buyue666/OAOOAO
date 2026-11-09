/** Adapted from video-canvas (MIT), Copyright (c) 2026 Smooth.
 * Full permission notice: VIDEO-CANVAS-LICENSE.txt in this directory. */
import type { PoseId } from "./catalog";

import type { BoneRotations } from "./pose";

type Rotation = readonly [number, number, number];

/** 按「左边」的习惯写的一份肢体旋转：键是不带 _l / _r 的骨骼名，例如 upperarm、thigh */
type LimbSpec = Record<string, Rotation>;

/** 镜像到右边：x 不变，y、z 取反（见 pose.ts 的说明） */
const mirror = ([x, y, z]: Rotation): Rotation => [x, -y, -z];

/** 把一份肢体旋转落到某一侧的骨骼上；右侧自动镜像，所以两侧都按左边的习惯写 */
const side = (which: "l" | "r", spec: LimbSpec): BoneRotations =>
  Object.fromEntries(
    Object.entries(spec).map(([name, rotation]) => [
      `${name}_${which}`,
      which === "l" ? rotation : mirror(rotation),
    ]),
  );

const left = (spec: LimbSpec) => side("l", spec);
const right = (spec: LimbSpec) => side("r", spec);
const both = (spec: LimbSpec): BoneRotations => ({ ...left(spec), ...right(spec) });

/** 手指弯曲：四指各三节，拇指弯得少一点；角度按手自己的轴算，正值弯向手心 */
const curl = (angle: number, fingers = ["index", "middle", "ring", "pinky"]): LimbSpec => ({
  ...Object.fromEntries(
    fingers.flatMap((finger) => [
      [`${finger}_01`, [0, 0, angle] as const],
      [`${finger}_02`, [0, 0, angle * 1.2] as const],
      [`${finger}_03`, [0, 0, angle * 0.8] as const],
    ]),
  ),
  ...(fingers.includes("middle")
    ? {
        thumb_01: [0, 0, angle * 0.3] as const,
        thumb_02: [0, 0, angle * 0.4] as const,
        thumb_03: [0, 0, angle * 0.4] as const,
      }
    : {}),
});

/** 放松垂下的手臂：模型静止是 T 字形，要把双臂放下来，肘微微弯，手半握 */
const RELAXED_ARM: LimbSpec = {
  upperarm: [0, 0, 82],
  lowerarm: [8, 0, 0],
  ...curl(25),
};

/** 躯干整体前倾 / 后仰：三节脊柱平分角度，负值向前倾 */
const lean = (total: number): BoneRotations => ({
  spine_01: [total / 3, 0, 0],
  spine_02: [total / 3, 0, 0],
  spine_03: [total / 3, 0, 0],
});

/**
 * 12 个姿势预设的骨骼旋转（坐标和符号约定见 pose.ts）。
 * 姿势在一段镜头里固定，不进时间轴；脚底、身体离地的高度由 figure.ts 摆好姿势后统一落地。
 */
export const POSE_ROTATIONS: Record<PoseId, BoneRotations> = {
  stand: both(RELAXED_ARM),

  walk: {
    ...left({
      ...RELAXED_ARM,
      thigh: [22, 0, 0],
      calf: [-8, 0, 0],
      upperarm: [-20, 0, 82],
      lowerarm: [28, 0, 0],
    }),
    ...right({
      ...RELAXED_ARM,
      thigh: [-18, 0, 0],
      calf: [-30, 0, 0],
      upperarm: [20, 0, 82],
      lowerarm: [30, 0, 0],
    }),
  },

  run: {
    ...left({
      ...curl(70),
      thigh: [60, 0, 0],
      calf: [-85, 0, 0],
      upperarm: [-40, 0, 80],
      lowerarm: [120, 0, 0],
    }),
    ...right({
      ...curl(70),
      thigh: [-25, 0, 0],
      calf: [-75, 0, 0],
      upperarm: [40, 0, 80],
      lowerarm: [50, 0, 0],
    }),
    ...lean(-18),
  },

  sit: {
    ...both({
      ...RELAXED_ARM,
      thigh: [90, 0, 0],
      calf: [-90, 0, 0],
      upperarm: [20, 0, 82],
      lowerarm: [65, 0, 0],
    }),
  },

  crouch: {
    ...both({
      ...RELAXED_ARM,
      thigh: [100, 0, 0],
      calf: [-125, 0, 0],
      upperarm: [35, 0, 75],
      lowerarm: [40, 0, 0],
    }),
    ...lean(-24),
    neck_01: [12, 0, 0],
    Head: [10, 0, 0],
  },

  point: {
    ...left(RELAXED_ARM),
    ...right({
      upperarm: [95, 0, 75],
      lowerarm: [0, 0, 0],
      ...curl(70, ["middle", "ring", "pinky"]),
      thumb_01: [0, 0, 20],
      thumb_02: [0, 0, 20],
      thumb_03: [0, 0, 20],
    }),
  },

  armsCrossed: both({
    upperarm: [25, 0, 75],
    lowerarm: [100, 0, 60],
    ...curl(35),
  }),

  wave: {
    ...left(RELAXED_ARM),
    ...right({ upperarm: [0, 0, -55], lowerarm: [0, 0, -35] }),
  },

  talk: {
    ...left(RELAXED_ARM),
    ...right({ upperarm: [40, 0, 70], lowerarm: [60, 0, 0], ...curl(20) }),
  },

  raiseHand: {
    ...left(RELAXED_ARM),
    ...right({ upperarm: [0, 0, -90] }),
  },

  lookBack: {
    ...both(RELAXED_ARM),
    neck_01: [0, 30, 0],
    Head: [0, 40, 0],
  },

  // 仰面躺下：整个身体绕骨盆向后倒（头朝 +z）。旋转按世界轴累计，所以手臂不能再用「垂下」的角度
  // （躺下后那会变成垂直戳向地面），改成绕竖轴转 90°，顺着身体指向脚；手半握
  lying: {
    ...both({ upperarm: [0, -90, 0], ...curl(25) }),
    pelvis: [90, 0, 0],
  },
};
