/** Adapted from video-canvas (MIT), Copyright (c) 2026 Smooth.
 * Full permission notice: VIDEO-CANVAS-LICENSE.txt in this directory. */
import {
  Box3,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  SphereGeometry,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { FigureModel, PoseId } from "./catalog";

import { applyBoneRotations, captureRest, type RestPose } from "./pose";
import { POSE_ROTATIONS } from "./poses";

/** 人物站直时的身高（米） */
export const FIGURE_HEIGHT: Record<FigureModel, number> = { male: 1.78, female: 1.68 };

/** 人物头顶往上的高度（米，未缩放）：名字标签摆在这上面，留出举手的余地 */
export const FIGURE_TOP = 1.95;

/** 所有人台模型 */
export const FIGURE_MODELS: readonly FigureModel[] = ["male", "female"];

/**
 * 人台模型的地址：Quaternius Universal Base Characters 的 Superhero 男、女，处理成灰色无贴图，
 * 骨骼名称完全相同，所以姿势数据共用；许可证见 public/director/LICENSE.txt。
 */
const modelUrl = (model: FigureModel) => `/assets/director/${model}.glb`;

/** 人台模型的加载状态 */
export type FigureModelStatus = "idle" | "loading" | "ready" | "failed";

/** 模板：加载好的人台，每个人物从它克隆 */
type Template = {
  /** 外壳：把脸朝 +z 的模型转成脸朝 -z（我们的约定） */
  holder: Group;
  /** 静止姿势（T 字形）下的骨骼旋转 */
  rest: RestPose;
  /** 缩放到 FIGURE_HEIGHT 的系数 */
  scale: number;
};

/** 加载进度回调，参数是 0 ~ 1 的比例 */
export type ProgressListener = (fraction: number) => void;

type Slot = {
  template: Template | null;
  status: FigureModelStatus;
  pending: Promise<boolean> | null;
  /** 加载到哪了（0 ~ 1），只增不减 */
  fraction: number;
  /** 加载中途又来要同一个模型的调用方，也要能收到进度 */
  listeners: Set<ProgressListener>;
};

const emptySlot = (): Slot => ({
  template: null,
  status: "idle",
  pending: null,
  fraction: 0,
  listeners: new Set(),
});

const slots: Record<FigureModel, Slot> = { male: emptySlot(), female: emptySlot() };

/** 读模型文件的函数：默认从站点静态资源里取，测试里注入；读的过程中可以上报下载比例 */
export type ModelLoader = (
  model: FigureModel,
  onProgress?: ProgressListener,
) => Promise<ArrayBuffer>;

/** 某个人台模型加载到哪一步了；非 ready 时这类人物用简化形体顶着 */
export const figureModelStatus = (model: FigureModel = "male") => slots[model].status;

/** 清掉已加载的模型，回到没加载过的状态（测试用） */
export function resetFigureModel() {
  for (const model of FIGURE_MODELS) slots[model] = emptySlot();
}

/**
 * 读完响应体并按已下载的比例上报进度。
 * 要用 Content-Length 当总量；没有它就读完再报 1。
 * 服务器压缩传输时 Content-Length 是压缩后的大小，读到的字节会比它多，所以读的过程中最多报 0.99。
 */
export async function readWithProgress(
  response: Response,
  onProgress?: ProgressListener,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("Content-Length"));
  if (!onProgress || !response.body || !(total > 0)) {
    const buffer = await response.arrayBuffer();
    onProgress?.(1);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(Math.min(loaded / total, 0.99));
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);
  return bytes.buffer;
}

const fetchModel: ModelLoader = async (model, onProgress) => {
  const response = await fetch(modelUrl(model));
  if (!response.ok) throw new Error(`人物模型请求失败：${response.status}`);
  return readWithProgress(response, onProgress);
};

const findSkinned = (root: Object3D): SkinnedMesh | undefined => {
  let found: SkinnedMesh | undefined;
  root.traverse((node) => {
    if (!found && (node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh;
  });
  return found;
};

/**
 * 量人物在局部坐标里的包围盒：蒙皮网格要按当前骨骼姿势逐顶点算，
 * 不能用几何体自带的包围盒（那是静止姿势下的）。
 */
export function measureFigure(group: Object3D): Box3 {
  group.updateMatrixWorld(true);
  const skinned = findSkinned(group);
  if (!skinned) return new Box3().setFromObject(group);
  const inverse = group.matrixWorld.clone().invert();
  const toGroup = skinned.matrixWorld.clone().premultiply(inverse);
  const box = new Box3();
  const point = new Vector3();
  const count = skinned.geometry.attributes.position.count;
  for (let i = 0; i < count; i++) {
    skinned.getVertexPosition(i, point);
    box.expandByPoint(point.applyMatrix4(toGroup));
  }
  return box;
}

/** 把加载好的 glTF 整理成模板：套转向外壳、记下静止姿势、算出缩放 */
function prepareTemplate(scene: Object3D, model: FigureModel): Template {
  const skinned = findSkinned(scene);
  if (!skinned) throw new Error("人物模型里没有带骨骼的网格");
  const holder = new Group();
  holder.rotation.y = Math.PI;
  holder.add(scene);
  const rest = captureRest(skinned.skeleton);
  const height = measureFigure(holder).getSize(new Vector3()).y;
  if (!(height > 0)) throw new Error("人物模型的尺寸不对");
  return { holder, rest, scale: FIGURE_HEIGHT[model] / height };
}

/**
 * 加载一个人台模型，整个页面每个模型只读一次文件；加载过程中重复调用共用同一个请求，失败后再调用会重试。
 * 加载失败不抛错：这类人物退回简化形体，导出照常可用。
 * @param load 读模型文件的函数，默认从站点静态资源里取；测试里注入
 * @param model 要加载的模型，缺省男性
 * @param onProgress 上报加载进度（0 ~ 1，只增不减）：下载占前 90%，解析完成时是 1；已加载好的立刻报 1
 * @returns 是否加载成功
 */
export function loadFigureModel(
  load: ModelLoader = fetchModel,
  model: FigureModel = "male",
  onProgress?: ProgressListener,
): Promise<boolean> {
  const slot = slots[model];
  if (slot.status === "ready") {
    onProgress?.(1);
    return Promise.resolve(true);
  }
  if (onProgress) slot.listeners.add(onProgress);
  if (slot.pending) {
    onProgress?.(slot.fraction);
    return slot.pending;
  }
  slot.status = "loading";
  slot.fraction = 0;
  const report = (fraction: number) => {
    slot.fraction = Math.max(slot.fraction, fraction);
    for (const listener of slot.listeners) listener(slot.fraction);
  };
  slot.pending = (async () => {
    try {
      const buffer = await load(model, (fraction) => report(fraction * DOWNLOAD_SHARE));
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      slot.template = prepareTemplate(gltf.scene, model);
      slot.status = "ready";
      report(1);
      return true;
    } catch (error) {
      console.warn(`人物模型（${model}）加载失败，改用简化形体`, error);
      slot.template = null;
      slot.status = "failed";
      return false;
    } finally {
      slot.pending = null;
      slot.listeners.clear();
    }
  })();
  return slot.pending;
}

/** 下载在单个模型加载进度里占的比例，剩下的是解析 */
const DOWNLOAD_SHARE = 0.9;

/**
 * 加载一批人台模型（去重），只读用到的。
 * @param onProgress 上报总进度（0 ~ 1），是各个模型进度的平均
 * @returns 全部成功才是 true；有失败的，成功的那些照常可用
 */
export async function loadFigureModels(
  models: readonly FigureModel[],
  load: ModelLoader = fetchModel,
  onProgress?: ProgressListener,
): Promise<boolean> {
  const unique = [...new Set(models)];
  const fractions = unique.map(() => 0);
  const results = await Promise.all(
    unique.map((model, index) =>
      loadFigureModel(
        load,
        model,
        onProgress &&
          ((fraction) => {
            fractions[index] = fraction;
            onProgress(fractions.reduce((sum, f) => sum + f, 0) / unique.length);
          }),
      ),
    ),
  );
  return results.every(Boolean);
}

/** 模型没加载好时的简化形体：一根胶囊加一个头，站在地面上 */
function createCapsuleFigure(material: MeshStandardMaterial): Group {
  const group = new Group();
  const body = new Mesh(new CapsuleGeometry(0.24, 1.1, 4, 12), material);
  body.position.y = 0.83;
  const head = new Mesh(new SphereGeometry(0.115, 20, 14), material);
  head.position.y = 1.66;
  for (const mesh of [body, head]) {
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * 建一个人物灰模：面朝本地 -z、脚（或身体）刚好踩在 y = 0。
 * 模型已加载就克隆人台、套姿势预设再按姿势落地；否则是简化形体。
 * 每个人物有自己的材质，着色用人物的颜色。
 * @param options.model 男性或女性，缺省男性
 */
export function createFigure(options: { pose: PoseId; color: string; model?: FigureModel }): {
  group: Group;
  material: MeshStandardMaterial;
} {
  const material = new MeshStandardMaterial({
    color: options.color,
    roughness: 0.7,
    metalness: 0.05,
  });
  const slot = slots[options.model ?? "male"];
  if (!slot.template || slot.status !== "ready") {
    return { group: createCapsuleFigure(material), material };
  }
  const template = slot.template;
  const model = cloneSkinned(template.holder) as Group;
  const skinned = findSkinned(model)!;
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = material;
    mesh.castShadow = true;
    // 包围球是静止姿势下算的，躺下、举手后会被误裁掉
    mesh.frustumCulled = false;
    mesh.userData.sharedFigureGeometry = true;
  });
  applyBoneRotations(skinned.skeleton, template.rest, POSE_ROTATIONS[options.pose]);

  const body = new Group();
  body.scale.setScalar(template.scale);
  body.add(model);
  const group = new Group();
  group.add(body);
  // 按这个姿势落地：站着是脚踩地，坐着是脚踩地、屁股悬空，躺着是后背贴地
  body.position.y = -measureFigure(group).min.y;
  return { group, material };
}

/** Reuse the cloned rig while changing a pose. Shared templates are never mutated. */
export function updateFigure(group: Group, options: { pose: PoseId; model: FigureModel; rotations?: import('./pose').BoneRotations; color: string }) {
  const template = slots[options.model].template;
  const skinned = findSkinned(group);
  if (!template || !skinned) return false;
  applyBoneRotations(skinned.skeleton, template.rest, options.rotations ?? POSE_ROTATIONS[options.pose]);
  group.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(material => { if (material instanceof MeshStandardMaterial) material.color.set(options.color); });
  });
  const body = group.children[0];
  body.position.y = 0;
  body.position.y = -measureFigure(group).min.y;
  return true;
}
