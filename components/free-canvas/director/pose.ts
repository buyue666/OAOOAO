/** Adapted from video-canvas (MIT), Copyright (c) 2026 Smooth.
 * Full permission notice: VIDEO-CANVAS-LICENSE.txt in this directory. */
import { Euler, Quaternion, type Bone, type Skeleton } from "three";

/**
 * 骨骼姿势：每根骨骼在「人物局部坐标」里额外转多少度。
 * 人物局部坐标：x 朝人物右手、y 朝上、z 朝人物背后（人物脸朝 -z）。
 * 角度按右手定则、XYZ 顺序（先 z、再 y、最后 x）。
 *
 * 往往要记的几条（以人物为准）：
 * - 向下垂着的肢体（手臂、大腿、小腿）：绕 x 转正值是向前摆，负值是向后摆；
 *   绕 z 转正值是向人物右侧摆（左臂往里收、右臂往外抬）。
 * - 向上立着的躯干和头：绕 x 转负值是向前倾，正值是向后仰；绕 y 转正值是向左转。
 *
 * 旋转是累计的：子骨骼跟着父骨骼一起转，再加上自己的这份。没写的骨骼只跟着父骨骼走。
 * 例外是手指：手指的角度按「手自己的轴」算（静止姿势下手朝人物两侧伸开，手指沿 z 轴卷是弯向手心），
 * 手臂不管抬到哪里，手指都是跟着手腕一起转，再沿手自己的轴卷。
 */
export type BoneRotations = Partial<Record<string, readonly [number, number, number]>>;

/** 骨骼的静止姿势（绑定姿势下的本地旋转），按骨骼名存 */
export type RestPose = Map<string, Quaternion>;

const DEG = Math.PI / 180;

/** 手指骨骼：旋转按手自己的轴算，不按人物的世界轴 */
const FINGER = /^(index|middle|ring|pinky|thumb)_/;

/** 记下骨架当前的本地旋转当作静止姿势；要在摆任何姿势之前调用 */
export function captureRest(skeleton: Skeleton): RestPose {
  return new Map(skeleton.bones.map((bone) => [bone.name, bone.quaternion.clone()]));
}

/**
 * 把旋转表套到骨架上：先回到静止姿势，再让每根写了旋转的骨骼在人物局部坐标里转动。
 * 模型被一层转了 180° 的外壳包着（模型脸朝 +z，人物脸朝 -z），所以旋转轴先换算到模型自己的坐标：
 * 绕 x 和绕 z 的角度取反。
 * @param skeleton 要摆姿势的骨架（克隆出来的，不是模板）
 * @param rest 模板的静止姿势
 * @param rotations 骨骼名到旋转角度的表
 */
export function applyBoneRotations(skeleton: Skeleton, rest: RestPose, rotations: BoneRotations) {
  const bones = skeleton.bones;
  const parentOf = new Map<Bone, Bone | null>(
    bones.map((bone) => [bone, bones.includes(bone.parent as Bone) ? (bone.parent as Bone) : null]),
  );
  // 先父后子：没有父骨骼的先处理，之后每处理完一根就能处理它的子骨骼
  const ordered: Bone[] = [];
  const pending = new Set(bones);
  while (pending.size) {
    for (const bone of pending) {
      const parent = parentOf.get(bone);
      if (parent && pending.has(parent)) continue;
      ordered.push(bone);
      pending.delete(bone);
    }
  }

  const restWorld = new Map<Bone, Quaternion>();
  const total = new Map<Bone, Quaternion>();
  const world = new Map<Bone, Quaternion>();
  const identity = new Quaternion();
  for (const bone of ordered) {
    const parent = parentOf.get(bone) ?? null;
    const restLocal = rest.get(bone.name) ?? bone.quaternion;
    const rw = (parent ? restWorld.get(parent)!.clone() : new Quaternion()).multiply(restLocal);
    restWorld.set(bone, rw);

    const given = rotations[bone.name];
    const delta = given
      ? new Quaternion().setFromEuler(
          new Euler(-given[0] * DEG, given[1] * DEG, -given[2] * DEG, "XYZ"),
        )
      : identity;
    const parentTotal = parent ? total.get(parent)! : identity;
    const cumulative = FINGER.test(bone.name)
      ? parentTotal.clone().multiply(delta)
      : delta.clone().multiply(parentTotal);
    total.set(bone, cumulative);

    const newWorld = cumulative.clone().multiply(rw);
    world.set(bone, newWorld);
    const parentWorld = parent ? world.get(parent)! : identity;
    bone.quaternion.copy(parentWorld.clone().invert().multiply(newWorld));
    bone.updateMatrix();
  }
}

/** 给一份「只写了左边」的旋转表补上右边：左右镜像时 x 不变，y、z 取反 */
export function mirrorLeftRotations(left: BoneRotations): BoneRotations {
  const result: Record<string, readonly [number, number, number]> = {};
  for (const [name, rotation] of Object.entries(left)) {
    if (!rotation) continue;
    result[name] = rotation;
    if (name.endsWith("_l")) {
      result[`${name.slice(0, -2)}_r`] = [rotation[0], -rotation[1], -rotation[2]];
    }
  }
  return result;
}
