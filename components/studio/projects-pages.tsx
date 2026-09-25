"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bot,
  Check,
  Clapperboard,
  Clock3,
  Download,
  FileText,
  Film,
  Grid2X2,
  GripVertical,
  Heart,
  Image as ImageIcon,
  List,
  Maximize2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { CanvasWorkspace } from "./canvas-workspace";
import { DirectorAgent } from "./director-agent";
import {
  ControlButton,
  EmptyState,
  IconAction,
  MediaThumb,
  Modal,
  Notice,
  PageHeader,
  ProgressBar,
  SearchField,
  SectionHeading,
  SelectField,
  SegmentedControl,
  SidePanel,
  StatusBadge,
} from "./ui";
import {
  getProject,
  getSelectedProjectShots,
  useStudio,
} from "@/lib/studio/store";
import { media } from "@/lib/studio/mock-data";
import type { ProjectStatus } from "@/lib/studio/types";
import {
  createDramaProject,
  getDramaProject,
  StudioApiError,
} from "@/lib/studio/api";
import { canvasHandoffFromProjectId } from "@/lib/studio/drama-link";
import type { DramaProject, DramaShot, DramaSourceAsset } from "@/lib/studio/drama-types";
import { activeEpisodeOf, useLinkedDramaProject } from "@/lib/studio/use-drama-project";
import {
  consumeCreateIntent,
  dataUrlToFile,
  type IntentFile,
} from "@/lib/studio/create-intent";
import { uploadPersistentAsset, readImageSize } from "@/lib/studio/account-api";
import { bumpAccountData } from "@/lib/studio/account-data-sync";
import { useGeneration } from "@/lib/studio/generation-store";
import { isTerminalStatus, newClientRequestId } from "@/lib/studio/generation-api";
import { defaultModelFor, filterModelsByCapability, qualityLabel } from "@/lib/studio/studio-models";

const projectTabs = [
  { slug: "overview", label: "概览", icon: Grid2X2 },
  { slug: "script", label: "剧本", icon: FileText },
  { slug: "characters", label: "角色与场景", icon: Users },
  { slug: "storyboard", label: "分镜", icon: Clapperboard },
  { slug: "canvas", label: "画布", icon: WandSparkles },
  { slug: "cut", label: "成片", icon: Film },
];

type Shot = ReturnType<typeof getSelectedProjectShots>[number];
type Project = ReturnType<typeof getProject>;
type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

type TimelineClip = {
  id: string;
  duration: number;
};

const statusTone = (status: ProjectStatus): Tone =>
  status === "进行中" ? "accent" : status === "已完成" ? "success" : "muted";

const shotStatusTone = (status: Shot["status"]): Tone =>
  status === "已完成"
    ? "success"
    : status === "需重试"
      ? "warning"
      : status === "生成中"
        ? "accent"
        : "muted";

const shotStatusLabel = (status: Shot["status"]) =>
  status === "需重试" ? "失败，需重试" : status === "生成中" ? "处理中" : status;

function parseDuration(duration: string) {
  const match = duration.match(/\d+(?:\.\d+)?/);
  return match ? Math.max(1, Number(match[0])) : 5;
}

function formatTime(value: number) {
  const safeValue = Math.max(0, Math.round(value));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getShotMedia(shot: Shot | undefined, fallback: string) {
  return (
    shot?.candidates.find((candidate) => candidate.selected)?.src ??
    shot?.candidates[0]?.src ??
    fallback
  );
}

export function ProjectsPage() {
  const { state, dispatch, createProject, deleteProject } = useStudio();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部");
  const [view, setView] = useState("covers");
  const [sort, setSort] = useState("最近修改");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const filters = ["全部", "进行中", "已完成", "已归档"];
  const visible = useMemo(
    () =>
      state.projects
        .filter(
          (project) =>
            (filter === "全部" || project.status === filter) &&
            project.title.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "名称"
            ? a.title.localeCompare(b.title)
            : a.status === "进行中"
              ? -1
              : b.status === "进行中"
                ? 1
                : 0,
        ),
    [state.projects, filter, search, sort],
  );

  /**
   * 新建项目。
   *
   * 早先只 dispatch 本地状态，刷新后被服务端列表覆盖，项目等于丢失。
   * 现在等待后端创建成功后才跳转；失败时显示后端返回的原因。
   */
  async function submitCreateProject() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setActionError("");
    try {
      const project = await createProject(newTitle.trim());
      setNewTitle("");
      setCreateOpen(false);
      router.push(`/projects/${project.id}`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "创建项目失败，请稍后重试。");
    } finally {
      setCreating(false);
    }
  }

  /** 删除项目：调用后端删除，成功后才从列表移除。 */
  async function removeProject(projectId: string, title: string) {
    if (!window.confirm(`确认删除项目「${title}」？该操作会同时删除画布内容，且无法撤销。`)) return;
    setActionError("");
    try {
      await deleteProject(projectId);
      setNotice(`项目「${title}」已删除。`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除项目失败，请稍后重试。");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-5 sm:px-5 md:px-8 md:py-6 xl:px-10">
      <PageHeader
        eyebrow="工作区"
        title="项目"
        description="项目会连接剧本、素材、分镜、任务和最终成片。"
        actions={
          <ControlButton variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            新建项目
          </ControlButton>
        }
      />
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="搜索项目名称或标签"
          />
          <div className="flex max-w-full gap-1 overflow-x-auto">
            {filters.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setFilter(item)}
                className={
                  item === filter
                    ? "h-8 shrink-0 rounded-lg bg-muted px-3 text-xs font-medium text-foreground"
                    : "h-8 shrink-0 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SelectField
            value={sort}
            onChange={setSort}
            options={["最近修改", "名称"].map((item) => ({
              value: item,
              label: `排序：${item}`,
            }))}
            className="w-32"
          />
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              {
                value: "covers",
                label: "封面",
                icon: <Grid2X2 className="size-3.5" />,
              },
              {
                value: "list",
                label: "列表",
                icon: <List className="size-3.5" />,
              },
            ]}
          />
        </div>
      </div>
      {actionError && (
        <Notice tone="warning">
          <span className="min-w-0 flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError("")} className="shrink-0 text-[11px] underline">关闭</button>
        </Notice>
      )}
      {notice && (
        <Notice tone="accent">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="shrink-0 text-[11px] underline">关闭</button>
        </Notice>
      )}
      {visible.length === 0 ? (
        <EmptyState
          title="没有匹配的项目"
          description="试试更换筛选条件，或创建一个新的创作项目。"
          action={
            <ControlButton
              variant="primary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              新建项目
            </ControlButton>
          }
        />
      ) : view === "covers" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => void removeProject(project.id, project.title)}
            />
          ))}
        </div>
      ) : (
        <div className="studio-surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">项目</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">进度</th>
                <th className="px-4 py-3 font-medium">最近修改</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-border/70 last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center gap-3 hover:text-studio-accent"
                    >
                      <MediaThumb
                        src={project.cover}
                        alt={project.title}
                        fallback={project.title}
                        className="size-10"
                      />
                      <span className="font-medium">{project.title}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {project.type}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(project.status)}>
                      {project.status}
                    </StatusBadge>
                  </td>
                  <td className="w-44 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={project.progress} />
                      <span className="text-xs text-muted-foreground">
                        {project.progress}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {project.updatedAt}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-xs font-medium text-studio-accent hover:underline"
                    >
                      打开
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建项目"
        description="先创建一个容器，后续可以从图片、视频或剧本继续。"
        footer={
          <>
            <ControlButton variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </ControlButton>
            <ControlButton variant="primary" onClick={() => void submitCreateProject()} disabled={creating || !newTitle.trim()}>
              {creating ? "正在创建…" : "创建项目"}
            </ControlButton>
          </>
        }
      >
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            项目名称
          </span>
          <input
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") void submitCreateProject();
            }}
            placeholder="例如：春日品牌片"
            className="studio-field h-10 border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
          />
          <span className="text-[11px] leading-5 text-muted-foreground">
            项目会在服务端持久化，刷新、重新登录或更换浏览器后仍可继续编辑。
          </span>
        </label>
      </Modal>
    </div>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project | undefined;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // 列表数据尚未就绪时不渲染卡片，避免读 undefined 的属性崩溃。
  if (!project) return null;

  return (
    <article className="studio-surface studio-surface-interactive group min-w-0 overflow-hidden">
      <Link href={`/projects/${project.id}`} className="block">
        <MediaThumb
          src={project.cover}
          alt={project.title}
          fallback={project.title}
          className="aspect-[16/9]"
          overlay={
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-studio-ink/75 to-transparent px-3.5 pb-2.5 pt-8">
              <StatusBadge solid tone={statusTone(project.status)}>
                {project.status}
              </StatusBadge>
              <span className="text-xs text-studio-ink-muted">
                {project.updatedAt}
              </span>
            </div>
          }
        />
      </Link>
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/projects/${project.id}`}
              className="block truncate text-sm font-semibold text-foreground hover:text-studio-accent"
            >
              {project.title}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.type} · {project.shotCount} 个镜头 · {project.progress}% 完成
            </p>
          </div>
          <div className="relative">
            <IconAction
              label="项目菜单"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal />
            </IconAction>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-10 w-32 rounded-lg border border-border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                >
                  <Trash2 className="size-3.5" />
                  删除项目
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
          {project.description}
        </p>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`${project.title} 项目进度`}
          aria-valuenow={project.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-studio-accent transition-[width] duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }}
          />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {project.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {project.chapterCount} 章 · {project.shotCount} 镜头
          </span>
        </div>
      </div>
    </article>
  );
}

export function ProjectWorkspacePage({
  projectId,
  sub = "overview",
}: {
  projectId: string;
  sub?: string;
}) {
  const { state } = useStudio();
  const router = useRouter();
  const project = getProject(state, projectId);
  const shots = getSelectedProjectShots(state, project?.id ?? "");
  const [activeShotId, setActiveShotId] = useState(shots[0]?.id ?? "");
  const [agentOpen, setAgentOpen] = useState(false);
  const currentShot = shots.find((shot) => shot.id === activeShotId) ?? shots[0];
  const activeTab = projectTabs.some((tab) => tab.slug === sub)
    ? sub
    : "overview";
  const agentContext =
    activeTab === "storyboard"
      ? `分镜 · ${currentShot?.title ?? "未选择"}`
      : `项目 · ${project?.title ?? ""}`;

  /**
   * 项目不存在时不能回落到第一个项目，也不能直接读 project.id。
   * 分别处理：会话未就绪（加载中）、未登录、列表为空、ID 不存在。
   */
  if (!project) {
    const checking = !state.hydrated || state.backendStatus === "checking";
    const signedOut = state.backendStatus === "unauthenticated";
    const empty = state.backendStatus === "connected" && state.projects.length === 0;
    const title = checking
      ? "正在载入项目"
      : signedOut
        ? "请先登录后查看项目"
        : empty
          ? "还没有项目"
          : "项目不存在";
    const description = checking
      ? "正在读取你的项目列表。"
      : signedOut
        ? "登录后可以访问属于你的项目与画布。"
        : empty
          ? "项目会在你创建画布或短剧后出现在这里。"
          : "该项目可能已被删除，或不属于当前账户。";
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-5 py-16">
        <div className="studio-surface p-7 text-center">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <ControlButton variant="primary" size="sm" onClick={() => router.push("/projects")}>返回项目列表</ControlButton>
            {signedOut && <ControlButton variant="secondary" size="sm" onClick={() => router.push(`/login?next=${encodeURIComponent(`/projects/${projectId}/${sub}`)}`)}>前往登录</ControlButton>}
            {state.backendStatus === "offline" && <ControlButton variant="secondary" size="sm" onClick={() => window.location.reload()}>重试</ControlButton>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-5 md:px-6 xl:px-8">
      <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/projects"
            className="hidden text-xs text-muted-foreground hover:text-foreground sm:inline"
          >
            项目
          </Link>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-[-0.025em] text-foreground">
              {project.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.type} · {project.updatedAt} · {project.progress}% 完成
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ControlButton size="sm" variant="secondary" onClick={() => setAgentOpen(true)}>
            <Bot className="size-3.5" />
            导演 Agent
          </ControlButton>
          <ControlButton size="sm" variant="ghost">
            <Settings2 className="size-3.5" />
            项目设置
          </ControlButton>
          <Link
            href={`/canvas/${project.id}`}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <WandSparkles className="size-3.5" />
            打开全屏画布
          </Link>
        </div>
      </div>

      <nav
        className="studio-scroll-x flex max-w-full gap-1 overflow-x-auto border-b border-border pb-2"
        aria-label="项目内导航"
        data-mobile-scroll
      >
        {projectTabs.map(({ slug, label, icon: Icon }) => {
          const selected = activeTab === slug;
          return (
            <Link
              key={slug}
              href={`/projects/${project.id}/${slug}`}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-foreground"
                  : "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "canvas" ? (
        <CanvasWorkspace projectId={project.id} />
      ) : (
        <>
          {activeTab === "overview" && (
            <ProjectOverview project={project} shots={shots} />
          )}
          {activeTab === "script" && (
            <ScriptWorkspace project={project} />
          )}
          {activeTab === "characters" && (
            <CharactersWorkspace projectId={project.id} />
          )}
          {activeTab === "storyboard" && (
            <StoryboardWorkspace project={project} />
          )}
          {activeTab === "cut" && (
            <CutWorkspace
              project={project}
              shots={shots}
              activeShotId={activeShotId}
              onSelectShot={setActiveShotId}
            />
          )}
          <SidePanel
            open={agentOpen}
            onClose={() => setAgentOpen(false)}
            title="导演 Agent"
            description={agentContext}
            width="lg:w-[420px]"
          >
            <DirectorAgent
              projectId={project.id}
              context={agentContext}
              showHeader={false}
              emptyStateLayout="stacked"
            />
          </SidePanel>
        </>
      )}
    </div>
  );
}

function ProjectOverview({
  project,
  shots,
}: {
  project: Project | undefined;
  shots: Shot[];
}) {
  const { state } = useStudio();
  const projectId = project?.id ?? "";
  const projectTasks = useMemo(
    () => state.tasks.filter((task) => task.projectId === projectId),
    [projectId, state.tasks],
  );
  const projectAssets = useMemo(
    () => state.assets.filter((asset) => asset.projectIds.includes(projectId)),
    [projectId, state.assets],
  );
  if (!project) return null;
  const tasksInProgress = projectTasks.filter(
    (task) => task.status === "processing" || task.status === "queued",
  ).length;
  const shotsToHandle = shots.filter((shot) => shot.status !== "已完成");
  const nextStep = shots.length === 0
    ? { tab: "script", title: "继续写剧本", detail: "先补充章节和场景正文，再进入分镜。", icon: FileText }
    : shotsToHandle.length > 0
      ? { tab: "storyboard", title: "完成分镜", detail: `${shotsToHandle.length} 个镜头仍需要生成或重试。`, icon: Clapperboard }
      : project.progress < 85
        ? { tab: "characters", title: "完善角色资料", detail: "补齐视觉参考，让后续镜头保持一致。", icon: Users }
        : { tab: "cut", title: "进入成片", detail: "整理镜头顺序并准备演示导出。", icon: Film };
  const nextSteps = [
    { tab: "script", title: "继续写剧本", detail: "补充场景与对白", icon: FileText },
    { tab: "characters", title: "完善角色", detail: "整理视觉资料", icon: Users },
    { tab: "storyboard", title: "生成分镜", detail: "处理镜头候选", icon: Clapperboard },
    { tab: "cut", title: "进入成片", detail: "编排时间线", icon: Film },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <div className="relative overflow-hidden border border-border bg-studio-ink">
          <MediaThumb
            src={project.cover}
            alt={project.title}
            fallback={project.title}
            className="aspect-video"
            overlay={
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-studio-ink/85 to-transparent px-5 pb-5 pt-20">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge solid tone={statusTone(project.status)}>
                    {project.status}
                  </StatusBadge>
                  <span className="text-xs text-studio-ink-muted">项目封面</span>
                </div>
                <p className="mt-2 text-xl font-semibold text-studio-ink-foreground">
                  {project.title}
                </p>
                <p className="mt-1 max-w-xl text-xs leading-5 text-studio-ink-muted">
                  {project.description}
                </p>
              </div>
            }
          />
        </div>
        <div className="studio-surface flex flex-col gap-5 p-5">
          <SectionHeading
            title="项目状态"
            description="从剧本到成片的当前进度。"
          />
          <div className="grid grid-cols-2 gap-x-5 gap-y-5">
            <div>
              <p className="text-xs text-muted-foreground">完成度</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {project.progress}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">章节</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {project.chapterCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">镜头</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {project.shotCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">进行中任务</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-studio-accent">
                {tasksInProgress}
              </p>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">整体完成度</span>
              <span className="text-muted-foreground">最近更新 {project.updatedAt}</span>
            </div>
            <ProgressBar value={project.progress} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {project.tags.map((tag) => (
              <StatusBadge key={tag}>{tag}</StatusBadge>
            ))}
          </div>
        </div>
      </div>

      <section className="border-y border-border py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              下一步
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-foreground">
              {nextStep.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{nextStep.detail}</p>
          </div>
          <Link href={`/projects/${project.id}/${nextStep.tab}`}>
            <ControlButton variant="primary">
              <nextStep.icon className="size-3.5" />
              继续工作
              <ArrowUpRight className="size-3.5" />
            </ControlButton>
          </Link>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {nextSteps.map((step) => {
            const selected = step.tab === nextStep.tab;
            return (
              <Link
                key={step.tab}
                href={`/projects/${project.id}/${step.tab}`}
                className={
                  selected
                    ? "flex items-center gap-3 rounded-lg border border-foreground bg-muted px-3 py-3"
                    : "flex items-center gap-3 rounded-lg border border-border px-3 py-3 hover:bg-muted"
                }
              >
                <step.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{step.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{step.detail}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="studio-surface p-4">
          <SectionHeading
            title="最近任务"
            action={
              <Link href="/tasks" className="text-xs text-studio-accent hover:underline">
                查看全部
              </Link>
            }
          />
          <div className="mt-3 flex flex-col">
            {projectTasks.slice(0, 4).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
              >
                <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{task.stage}</p>
                </div>
                <StatusBadge
                  tone={
                    task.status === "completed"
                      ? "success"
                      : task.status === "failed"
                        ? "warning"
                        : "accent"
                  }
                >
                  {task.status === "completed" ? "完成" : task.status === "failed" ? "失败" : "进行中"}
                </StatusBadge>
              </div>
            ))}
            {projectTasks.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">还没有项目任务。</p>
            )}
          </div>
        </section>

        <section className="studio-surface p-4">
          <SectionHeading title="最新素材" />
          <div className="mt-3 flex flex-col">
            {projectAssets.slice(0, 4).map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
              >
                <MediaThumb
                  src={asset.src || undefined}
                  poster={asset.poster}
                  alt={asset.title}
                  fallback={asset.fallback}
                  kind={asset.kind === "video" ? "video" : "image"}
                  className="size-11 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{asset.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{asset.createdAt} · {asset.size}</p>
                </div>
                <StatusBadge tone={asset.status === "处理中" ? "accent" : "neutral"}>
                  {asset.status}
                </StatusBadge>
              </div>
            ))}
            {projectAssets.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">还没有关联素材。</p>
            )}
          </div>
        </section>

        <section className="studio-surface p-4">
          <SectionHeading
            title="需要处理的镜头"
            action={
              <Link href={`/projects/${project.id}/storyboard`} className="text-xs text-studio-accent hover:underline">
                打开分镜
              </Link>
            }
          />
          <div className="mt-3 flex flex-col">
            {shotsToHandle.slice(0, 4).map((shot) => (
              <Link
                key={shot.id}
                href={`/projects/${project.id}/storyboard`}
                className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0 hover:text-studio-accent"
              >
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{String(shot.index).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{shot.title}</span>
                <StatusBadge tone={shotStatusTone(shot.status)}>{shotStatusLabel(shot.status)}</StatusBadge>
              </Link>
            ))}
            {shotsToHandle.length === 0 && (
              <div className="flex items-center gap-2 py-6 text-xs text-success">
                <Check className="size-4" />
                所有示例镜头都已完成。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * 剧本页。
 *
 * 背景（本轮复现的真实缺陷）：这里的正文与对白来自 `getSelectedProjectShots`
 * ——也就是 `mock-data.ts` 里 key 为 `aurora` 的**本地演示镜头**，
 * 而「保存草稿」只把 React state 改成「已保存 · 刚刚」，**一个写请求都没发**：
 * 刷新后文本回到硬编码的默认值，用户以为保存了，其实什么都没发生。
 *
 * 现在的事实来源是**真实短剧项目**（`/api/drama/projects/<dramaId>`）：
 *  - 有镜头时：场景列表 = 真实镜头，正文/对白 = `shot.description` / `shot.dialogue`；
 *  - 没有镜头时：正文 = 该分集的 `script`；
 *  - 保存 = `PATCH /api/drama/projects/<dramaId>`，并且**核对返回值**确认真写进去了。
 *
 * 画布项目与短剧项目是两个命名空间，这里绝不把画布 id 当短剧 id 用；
 * 解析不到短剧项目时如实显示「未关联」并提供真实的创建入口（见 `ScriptUnlinkedNotice`）。
 */
function ScriptWorkspace({
  project,
}: {
  project: Project | undefined;
}) {
  const canvasProjectId = project?.id ?? "";
  const drama = useLinkedDramaProject(canvasProjectId);
  const dramaProject = drama.project;
  const episode = useMemo(() => activeEpisodeOf(dramaProject), [dramaProject]);
  /**
   * 场景列表只来自真实镜头。
   *
   * 没有关联短剧项目时不退回演示数据——那正是本轮要修掉的假象：
   * 展示 `mock-data.ts` 的镜头会让用户以为「这个画布项目真有这些场景」。
   */
  const scenes = useMemo<DramaShot[]>(() => (dramaProject ? (episode?.shots ?? []) : []), [dramaProject, episode]);
  /**
   * 选中的镜头。
   *
   * 进页面时尚未加载完 `dramaProject`，此时用「镜头 id 为空」表达，
   * 内容来源交给 `episode.script`（真实分集正文），而不是本地演示数据。
   */
  const [activeShotId, setActiveShotId] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [dialogueText, setDialogueText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  /**
   * 「当前编辑区里的内容」的版本号，每次用户改动自增。
   *
   * 用途：保存是异步的，用户在等待期间还能继续输入。
   * 只凭「请求成功」就清 dirty / 回写编辑区，会把等待期间新输入的内容丢掉
   * （本轮复现的真实缺陷：输入 A → 保存中继续输入 B → 释放 A 的成功响应 →
   * 编辑区被回滚成 A、B 丢失、按钮禁用、还显示「已保存」）。
   *
   * 因此提交前记下 `editRev`，响应回来时对比：
   *  - 相等 → 期间没有新输入，可以清 dirty 并按服务端结果同步；
   *  - 不等 → 期间又改了，**只确认已提交的那份**，保留当前草稿并保持未保存。
   */
  const editRevRef = useRef(0);
  /**
   * 每次「保存完成、服务端版本被推进」时自增。
   *
   * 同步 effect 依赖它而不是直接比对 `dramaProject.updatedAt`：
   * 后者在**别的**写入路径（分镜写回、首页意图套用）里也会变，
   * 那些变化不应该把用户正在编辑的草稿冲掉。
   */
  const [syncedRev, setSyncedRev] = useState(0);
  /**
   * 迟到响应的归属校验。
   *
   * 保存请求发出后，用户可能切换场景、切换项目甚至换账号；
   * 那时响应对当前编辑区**没有意义**，写入就会造成串数据。
   * 每次「进入一个不同的编辑目标」都自增，响应回来时比对是否仍是同一个目标。
   */
  const editTargetRef = useRef(0);
  /** 保存撞上版本冲突（后端 409）：草稿保留，另外给出查看最新版本 / 复制草稿的入口。 */
  const [conflict, setConflict] = useState(false);
  /** 「查看最新版本」读到的服务端快照。只读展示，绝不写回编辑区。 */
  const [latestProject, setLatestProject] = useState<DramaProject | null>(null);
  const [notice, setNotice] = useState("");
  /**
   * 待确认的切换目标（确认弹窗）。
   *
   * 「保存并切换」是**两个独立的意图**：先保存、再切换。
   * 用户可能在保存期间点「留在当前场景」取消切换 —— 那时保存**已经提交**，
   * 不能撤销（也不该谎报没保存），但**切换必须作废**。
   * 因此切换意图单独版本化：任何"取消 / 改选 / 留在当前场景 / 关闭弹窗"
   * 都让当前意图失效，await 结束后再核对，失效就不切。
   */
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  /**
   * 切换意图版本：每次"设定或取消一个切换意图"都自增。
   *
   * `confirmSceneChange` 在 await 保存**之前**快照它，await **之后**比对；
   * 不一致说明用户在保存期间取消或改选了，本次切换必须放弃。
   * 只靠比对 `pendingSceneId` 不够：用户可能取消后**又选了同一个场景**，
   * 那是一个**新的**意图，应当生效（版本号能区分这两种情况）。
   */
  const sceneIntentRef = useRef(0);
  /** 已套用过首页创作意图的项目：避免同一次会话里重复套用。 */
  const intentAppliedRef = useRef("");

  const activeShot = scenes.find((shot) => shot.id === activeShotId);
  const totalSeconds = scenes.reduce((sum, shot) => sum + Math.max(1, Number(shot.duration) || 5), 0);
  const activeTitle = activeShot?.title || episode?.title || "新场景";

  /**
   * 把服务端内容同步到编辑区。
   *
   * 触发时机由 `loadedKey` 决定，它由三部分构成：
   *  - `syncedRev`：**保存成功推进了服务端版本**时才会变。用它而不是直接用
   *    `dramaProject.updatedAt`，是因为后者在分镜写回、首页意图套用等**别的**
   *    写入路径里也会变；那些变化与本编辑区的草稿无关，
   *    不应触发"用服务端内容覆盖编辑区"（否则同样会冲掉用户正在输入的内容）。
   *  - `episode.id` / `activeShotId`：换分集、换场景要重新载入该目标的正文。
   *
   * **前提**：草稿不脏。未保存的草稿绝不能被服务端内容覆盖，
   * 这是"保存失败要保留草稿"的另一面；保存期间继续输入的情形也由
   * `dirty` 守住（修复后 `persistDraft` 只在没有新输入时才清 dirty）。
   */
  const loadedKey = dramaProject ? `${dramaProject.id}:${syncedRev}:${episode?.id ?? ""}:${activeShotId}` : "";
  useEffect(() => {
    if (!dramaProject || !episode) return;
    if (dirty) return;
    setBodyText(activeShot ? activeShot.description : episode.script);
    setDialogueText(activeShot ? activeShot.dialogue : "");
    // dirty 变化时不需要重跑（保存成功由 syncedRev 变化驱动）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  /** 切换分集/项目时重置选中镜头，避免指向另一个分集的镜头 id。 */
  useEffect(() => {
    setActiveShotId((current) => (scenes.some((shot) => shot.id === current) ? current : (scenes[0]?.id ?? "")));
  }, [scenes]);

  /**
   * 编辑目标变化（换短剧项目 / 换分集 / 换账号）时让在途保存响应失效。
   *
   * 保存请求发出后用户可能切走，迟到的响应绝不能写到新目标的编辑区
   * （那会把新项目的正文、对白、dirty 一并污染）。
   * `editTargetRef` 自增后，`persistDraft` 里的 `stillSameTarget()` 即为假。
   */
  useEffect(() => {
    editTargetRef.current += 1;
    editRevRef.current += 1;
    /** 换了编辑目标，之前的切换意图一并作废（否则旧意图会切到不存在的场景）。 */
    sceneIntentRef.current += 1;
    setPendingSceneId(null);
    setDirty(false);
    setSaveError("");
    setConflict(false);
    setSavedAt("");
  }, [dramaProject?.id, episode?.id]);

  /**
   * 消费首页传来的创作意图（读取即清除）。
   *
   * 首页 `startCreation()` 把提示词与参考文件写进 `create-intent` 后跳到本页，
   * 但此前**没有任何地方读取它**，用户输入的内容到此丢失。
   * 这里把它真实落库：正文写入分集 `script`（没有镜头时）或作为待补写内容提示，
   * 参考文件登记为项目 `sourceAssets`。
   */
  useEffect(() => {
    if (!dramaProject || !episode) return;
    if (intentAppliedRef.current === dramaProject.id) return;
    const intent = consumeCreateIntent("drama");
    if (!intent) return;
    const apply = async () => {
      setSaving(true);
      setSaveError("");
      try {
        const prompt = intent.prompt.trim();
        // 参考文件先真实上传为持久素材（后端会丢弃 data:/blob: 地址）。
        const { assets, failed } = await buildSourceAssets(intent.files);
        const saved = await drama.save((current) => {
          const next = assets.length ? { ...current, sourceAssets: mergeSourceAssets(current.sourceAssets, assets) } : current;
          if (!prompt) return next;
          return {
            ...next,
            episodes: next.episodes.map((item) => {
              if (item.id !== episode.id) return item;
              /**
               * 有镜头时不覆盖镜头正文（那是分镜内容），提示词落到分集大纲；
               * 没有镜头时把提示词并入分集正文，作为剧本正文的起点。
               */
              if (item.shots.length) return { ...item, outline: prompt };
              const merged = item.script.trim() ? `${item.script.trim()}\n\n${prompt}` : prompt;
              return { ...item, script: merged, scriptRichContent: undefined };
            }),
          };
        });
        // 只有写入确实成功才记下「已套用」，失败时保留重试机会（意图已被消费）。
        intentAppliedRef.current = dramaProject.id;
        setSavedAt(`已保存 · ${formatSavedAt(saved.updatedAt)}`);
        const written = [
          prompt ? "创作描述" : "",
          assets.length ? `${assets.length} 个参考文件` : "",
        ].filter(Boolean).join("与");
        setNotice(`已把首页的${written || "创作意图"}写入短剧项目。`);
        if (failed.length) setSaveError(`有 ${failed.length} 个参考文件上传失败，未写入项目：${failed.join("、")}`);
      } catch (reason) {
        // 失败必须如实报告，并且不清空任何用户内容。
        setSaveError(reason instanceof Error ? reason.message : "首页创作描述写入失败");
      } finally {
        setSaving(false);
      }
    };
    void apply();
    // 只在短剧项目首次加载完成时消费一次意图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramaProject?.id, episode?.id]);

  // 所有 hook 已执行完毕，这里可以安全地短路渲染，避免读 undefined 的属性。
  if (!project) return null;
  const currentProject = project;

  function selectScene(sceneId: string) {
    const nextScene = scenes.find((shot) => shot.id === sceneId);
    if (!nextScene) return;
    /**
     * 切场景 = 进入另一个编辑目标。
     * 让在途保存的响应失效（`stillSameTarget()` 会返回 false），
     * 否则上一个场景的保存结果会写到新场景的编辑区里。
     * 同时把编辑版本推进一格，避免把"上一个场景的提交版本"误判成当前草稿。
     */
    editTargetRef.current += 1;
    editRevRef.current += 1;
    setActiveShotId(sceneId);
    setBodyText(nextScene.description);
    setDialogueText(nextScene.dialogue);
    setDirty(false);
    setPendingSceneId(null);
  }

  function requestSceneChange(sceneId: string) {
    if (sceneId === activeShotId) return;
    if (dirty) {
      /** 新的切换意图：让上一个在途意图失效（版本号区分"改选"与"取消"）。 */
      sceneIntentRef.current += 1;
      setPendingSceneId(sceneId);
      return;
    }
    selectScene(sceneId);
  }

  /**
   * 取消当前切换意图（点「留在当前场景」/ 关闭弹窗 / 点「放弃并切换」）。
   *
   * 只作废**切换意图**，不动保存状态：
   * 若此时已有一个"保存并切换"的保存在途，它仍会正常完成并如实汇报，
   * 只是**不再切换场景**（这正是本轮修复的要点）。
   */
  function cancelSceneIntent() {
    sceneIntentRef.current += 1;
    setPendingSceneId(null);
  }

  /**
   * 真实保存。
   *
   * 写入位置：有镜头 → 该镜头的 `description` / `dialogue`；没有镜头 → 分集的 `script`。
   *
   * 保存会**带上本页读到的那一版 `updatedAt`**（由 `drama.save` 负责），
   * 后端据此做乐观锁：
   *  - 200：核对返回值，只有返回内容里确实出现了刚提交的文本才算成功；
   *  - 409：别的窗口已经先写入 → 进入冲突态（保留草稿 + 提供查看/复制入口）；
   *  - 其他失败（网络中断、5xx）：同样保留草稿并显示后端原文。
   *
   * 任何一条失败路径都**不清空编辑区**，也绝不显示「已保存」。
   */
  async function persistDraft(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setSaveError("");
    setConflict(false);
    /**
     * 记下"本次提交的是哪一份草稿"与"提交时用户在哪个编辑目标"。
     *
     * 保存是异步的，等待期间用户还能继续输入、甚至切换场景或项目。
     * 响应回来时必须能判断：这份响应还属不属于**当前**编辑区。
     */
    const submittedRev = editRevRef.current;
    const submittedTarget = editTargetRef.current;
    /** 响应回来时本次编辑目标是否仍然有效（没切场景/项目/账号）。 */
    const stillSameTarget = () => submittedTarget === editTargetRef.current;
    try {
      const targetId = activeShot?.id;
      const body = bodyText;
      const dialogue = dialogueText;
      const saved = await drama.save((current) => {
        const targetEpisodeId = episode?.id ?? current.episodes[0]?.id;
        return {
          ...current,
          episodes: current.episodes.map((item) => {
            if (item.id !== targetEpisodeId) return item;
            if (!targetId) {
              /**
               * 没有镜头：正文写进分集 `script`。
               *
               * 清掉 `scriptRichContent`：后端在它存在时**以富文本为准**
               * （`dramaRichContentToPlainText(scriptRichContent)` 会覆盖 `script`），
               * 不同步清除就会保存成功却看不到文本变化。
               */
              return { ...item, script: body, scriptRichContent: undefined };
            }
            return {
              ...item,
              shots: item.shots.map((shot) => shot.id === targetId ? { ...shot, description: body, dialogue } : shot),
            };
          }),
        };
      });
      /**
       * 迟到响应：用户在等待期间切了场景/项目/账号。
       *
       * 这次保存**已经真实落库**（后端已返回），所以不能谎报失败；
       * 但它属于**旧目标**，绝不能拿它去改当前编辑区的状态
       * （否则会把新目标的正文/对白/dirty 全部覆盖掉）。
       * 因此只提示，不写任何编辑区状态。
       */
      if (!stillSameTarget()) {
        setSavedAt(`已保存 · ${formatSavedAt(saved.updatedAt)}`);
        setNotice("上一次保存已完成（保存期间你切换了场景或项目，编辑区内容未被改动）。");
        return true;
      }
      const verified = verifyScriptSaved(saved, episode?.id ?? "", targetId ?? "", body, dialogue);
      if (!verified) {
        setDirty(true);
        setSaveError("服务端返回的内容与提交的草稿不一致，已保留草稿。请重试或刷新页面确认。");
        return false;
      }
      /**
       * 关键：只确认**已提交的那一份**，不能无条件清 dirty。
       *
       * 如果等待期间用户又输入了内容（`editRevRef` 已前进），
       * 那么当前编辑区里的是**更新的草稿**：
       *  - dirty 必须保持为真（它确实还没保存）；
       *  - 编辑区内容**原样保留**（绝不回滚成刚提交的旧文本）；
       *  - 提示语要说清"已保存的是提交的那一版"，避免用户误以为新输入也保存了。
       * `syncedRev` 也不推进：不推进就不会触发同步 effect 去覆盖编辑区。
       */
      const hasNewerEdits = editRevRef.current !== submittedRev;
      if (hasNewerEdits) {
        setDirty(true);
        setSavedAt(`已保存 · ${formatSavedAt(saved.updatedAt)}（保存期间的新输入尚未保存）`);
        setNotice("已保存你点击保存时的内容。保存期间新输入的部分仍在编辑区，尚未保存，请再次点击保存。");
        return true;
      }
      setDirty(false);
      setSavedAt(`已保存 · ${formatSavedAt(saved.updatedAt)}`);
      /**
       * 推进同步版本：让同步 effect 用**服务端确认过的文本**刷新编辑区
       * （而不是本地乐观值）。此时 dirty 为假且没有更新的输入，
       * 覆盖编辑区是安全的。
       */
      setSyncedRev((current) => current + 1);
      return true;
    } catch (reason) {
      /**
       * 失败：保留草稿、保持 dirty，并显示后端原文，绝不显示「已保存」。
       * 409 是「别的窗口先写了」而不是内容有问题，单独给出冲突说明与恢复入口。
       *
       * 注意**不区分**是否切了目标：失败时更要保住用户当前看到的内容，
       * 所以这里同样只在"目标仍有效"时才写错误态，避免把错误显示到别的场景上。
       */
      if (!stillSameTarget()) return false;
      setDirty(true);
      if (isDramaConflict(reason)) {
        setConflict(true);
        setSaveError(`${DRAMA_CONFLICT_MESSAGE}。你的修改仍保留在编辑区，未被覆盖。`);
      } else {
        setSaveError(reason instanceof Error ? reason.message : "保存失败，请稍后重试。");
      }
      return false;
    } finally {
      /**
       * 无论目标是否已切换都要清 `saving`：本次请求确实结束了。
       * 若不清，用户切到新场景后会一直卡在「保存中…」而无法保存新内容。
       */
      setSaving(false);
    }
  }

  /** 查看服务端最新版本：只读取，绝不覆盖编辑区里的草稿。 */
  async function viewLatestVersion() {
    setSaveError("");
    try {
      const latest = await getDramaProject(drama.dramaProjectId ?? "");
      setLatestProject(latest);
    } catch (reason) {
      setSaveError(`读取最新版本失败：${reason instanceof Error ? reason.message : "未知错误"}`);
    }
  }

  /** 复制草稿到剪贴板：即使冲突无法就地解决，内容也不会丢。 */
  async function copyDraft() {
    const draft = dialogueText ? `${bodyText}\n\n${dialogueText}` : bodyText;
    try {
      await navigator.clipboard.writeText(draft);
      setNotice("草稿已复制到剪贴板。");
    } catch {
      setSaveError("复制失败：浏览器拒绝了剪贴板访问，请手动选中编辑区内容复制。");
    }
  }

  /**
   * 确认弹窗的两个出口。
   *
   * 「保存并切换」= 先保存、**成功且意图未失效**才切换。
   *
   * 为什么不能只判断 `persistDraft()` 的返回值：
   *  - 用户可能在保存期间点「留在当前场景」取消了切换 → 保存照样完成（不撤销），
   *    但**绝不能**再切走（本轮缺陷：旧代码 await 回来直接 `selectScene(pendingSceneId)`，
   *    用了**过期的** `pendingSceneId`，把用户按取消后又输入的内容一起冲掉）；
   *  - 保存期间用户可能又输入了新内容 → `persistDraft` 返回 true 只代表
   *    "提交的那一份写成功了"，**不代表当前草稿已全部保存**，
   *    此时切场景会连带丢弃新输入。
   *
   * 因此 await 之后要**重新核对三件事**：意图版本、编辑目标、编辑版本。
   */
  async function confirmSceneChange(saveBeforeSwitch: boolean) {
    /** 快照本次意图：await 之后比对，判断用户是否已经取消或改选。 */
    const intent = sceneIntentRef.current;
    const targetSceneId = pendingSceneId;
    const targetEditTarget = editTargetRef.current;
    const targetEditRev = editRevRef.current;

    if (saveBeforeSwitch) {
      const saved = await persistDraft();
      // 保存失败就留在当前场景，不能把未保存的编辑丢掉。
      if (!saved) return;
    }

    /**
     * await 期间用户取消了切换（点「留在当前场景」/ 关闭弹窗 / 选了别的场景）。
     * 保存已经完成且已如实汇报，这里**只放弃切换**。
     */
    if (sceneIntentRef.current !== intent) return;
    /** 当前待切换目标已被清空或替换。 */
    if (!targetSceneId || pendingSceneId !== targetSceneId) return;
    /** 编辑目标变了（切了项目/分集/账号）—— 这次切换已经没有意义。 */
    if (editTargetRef.current !== targetEditTarget) return;
    /**
     * 保存期间又输入了新内容：**不能自动切换**，否则这些新输入会被丢弃。
     * 保留弹窗之外的提示，让用户自己决定（再次点「保存并切换」即可）。
     */
    if (saveBeforeSwitch && editRevRef.current !== targetEditRev) {
      setNotice("保存期间你又修改了内容，已留在当前场景以免丢失。确认无误后可再次点击「保存并切换」。");
      return;
    }

    selectScene(targetSceneId);
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[232px_minmax(0,1fr)]">
      <ScriptSidebar
        scenes={scenes}
        activeShotId={activeShotId}
        onSelect={requestSceneChange}
        loading={drama.state === "loading"}
      />
      <div className="min-w-0">
        {drama.state === "unlinked" && (
          <ScriptUnlinkedNotice canvasProjectId={canvasProjectId} title={currentProject.title} onLinked={() => void drama.reload()} />
        )}
        {drama.state === "error" && (
          <div className="mb-4">
            <Notice tone="warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                短剧项目读取失败：{drama.message}
                <button type="button" className="ml-2 underline" onClick={() => void drama.reload()}>重试</button>
              </span>
            </Notice>
          </div>
        )}
        {saveError && (
          <div className="mb-4">
            <Notice tone="warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="flex-1">
                {conflict ? "版本冲突：" : "保存失败："}{saveError}
                {conflict && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <ControlButton size="sm" variant="secondary" onClick={() => void viewLatestVersion()} data-testid="script-view-latest">
                      查看最新版本
                    </ControlButton>
                    <ControlButton size="sm" variant="secondary" onClick={() => void copyDraft()} data-testid="script-copy-draft">
                      复制草稿
                    </ControlButton>
                    <span className="text-[11px] text-muted-foreground">
                      你的修改仍保留在编辑区；确认最新版本后再决定是否覆盖保存。
                    </span>
                  </span>
                )}
              </span>
            </Notice>
          </div>
        )}
        {latestProject && (
          <div className="mb-4" data-testid="script-latest-version">
            <section className="studio-surface overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">服务端最新版本（只读）</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {latestProject.title} · 版本 {formatSavedAt(latestProject.updatedAt)}
                  </p>
                </div>
                <ControlButton size="sm" variant="ghost" onClick={() => setLatestProject(null)}>收起</ControlButton>
              </div>
              <div className="max-h-72 overflow-auto px-4 py-3">
                {latestVersionEpisode(latestProject).map((item) => (
                  <article key={item.id} className="border-b border-border/70 py-3 last:border-b-0">
                    <p className="text-xs font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{item.text || "（空）"}</p>
                  </article>
                ))}
              </div>
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                这里只展示服务端内容，不会覆盖你编辑区里的草稿。
              </p>
            </section>
          </div>
        )}
        {notice && (
          <div className="mb-4">
            <Notice tone="accent">
              <Check className="mt-0.5 size-3.5 shrink-0" />
              {notice}
            </Notice>
          </div>
        )}
        <ScriptPanel
          project={project}
          sceneTitle={activeTitle}
          sceneMeta={
            drama.state === "loading"
              ? "正在读取短剧项目…"
              : activeShot
                ? `${activeShot.duration} 秒 · ${shotStatusLabel(dramaShotStatus(activeShot))}`
                : episode
                  ? `${episode.title} · 尚未拆分镜头`
                  : "短剧项目未关联"
          }
          bodyText={bodyText}
          dialogueText={dialogueText}
          dirty={dirty}
          saving={saving}
          canSave={Boolean(dramaProject) && !saving}
          savedAt={savedAt}
          totalSeconds={totalSeconds}
          sceneCount={scenes.length}
          onBodyChange={(value) => {
            /** 每次实际改动推进编辑版本：保存响应据此判断"期间是否又改了"。 */
            editRevRef.current += 1;
            setBodyText(value);
            setDirty(true);
            setSavedAt("");
            setSaveError("");
            setConflict(false);
          }}
          onDialogueChange={(value) => {
            editRevRef.current += 1;
            setDialogueText(value);
            setDirty(true);
            setSavedAt("");
            setSaveError("");
            setConflict(false);
          }}
          onSave={() => { void persistDraft(); }}
        />
        <p className="mt-3 px-1 text-[11px] leading-5 text-muted-foreground">
          {drama.state === "unlinked"
            ? "当前画布项目没有关联的短剧项目，因此没有可写入的剧本存储；请先创建短剧项目。"
            : drama.state === "ready"
              ? `保存会把正文与对白写入短剧项目 ${drama.dramaProjectId}（接口 PATCH /api/drama/projects/${drama.dramaProjectId}），刷新或换设备后仍然保留。`
              : "画布项目与短剧项目是两套数据；本页只写入真实短剧项目，不做本地演示保存。"}
        </p>
      </div>
      <Modal
        open={Boolean(pendingSceneId)}
        /**
         * 关闭弹窗同样算取消切换意图：否则「保存并切换」在途时关掉弹窗，
         * 迟到响应回来看到 `pendingSceneId` 仍在，还是会切走（本轮缺陷的另一种触发方式）。
         */
        onClose={cancelSceneIntent}
        title="当前场景还有未保存修改"
        description="切换场景前请选择如何处理当前草稿，内容不会被静默丢弃。"
        footer={
          <>
            <ControlButton variant="ghost" onClick={cancelSceneIntent}>
              留在当前场景
            </ControlButton>
            <ControlButton variant="secondary" onClick={() => confirmSceneChange(false)}>
              放弃并切换
            </ControlButton>
            <ControlButton variant="primary" disabled={saving} onClick={() => void confirmSceneChange(true)}>
              {saving ? "保存中…" : "保存并切换"}
            </ControlButton>
          </>
        }
      >
        <Notice tone="warning">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" />
          当前草稿尚未保存。选择“保存并切换”会先写入服务端，成功后才切换场景。
        </Notice>
      </Modal>
    </div>
  );
}

/** 短剧镜头状态 → 剧本页展示用的通用状态。 */
function dramaShotStatus(shot: DramaShot): Shot["status"] {
  if (shot.storyboardStatus === "success") return "已完成";
  if (shot.storyboardStatus === "error") return "需重试";
  if (shot.storyboardStatus === "queued" || shot.storyboardStatus === "running") return "生成中";
  return "待生成";
}

/** 服务端时间戳 → 「刚刚 / HH:mm」；解析失败时如实退回服务端原文。 */
function formatSavedAt(updatedAt: string) {
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return updatedAt || "服务端已确认";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return "刚刚";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

/**
 * 核对保存结果。
 *
 * 返回 200 也要核对：只有返回的分集/镜头里确实出现了刚提交的文本才算成功。
 * （版本冲突现在由后端 409 明确表达，不再表现为「200 但内容没变」；
 *  这里保留核对是为了防止任何其他形式的假成功。）
 */
function verifyScriptSaved(saved: DramaProject, episodeId: string, shotId: string, body: string, dialogue: string) {
  const episode = saved.episodes.find((item) => item.id === episodeId) ?? saved.episodes[0];
  if (!episode) return false;
  if (!shotId) return episode.script === body;
  const shot = episode.shots.find((item) => item.id === shotId);
  if (!shot) return false;
  return shot.description === body && shot.dialogue === dialogue;
}

/**
 * 版本冲突（后端 409）的判定。
 *
 * 依赖 `StudioApiError.status`，不匹配文案：后端可能调整措辞，
 * 而冲突语义由状态码唯一确定。
 */
function isDramaConflict(reason: unknown) {
  return reason instanceof StudioApiError && reason.status === 409;
}

/** 版本冲突的固定提示文案（与后端 409 的 `msg` 保持一致）。 */
const DRAMA_CONFLICT_MESSAGE = "该短剧项目已在其他窗口被修改";

/**
 * 「查看最新版本」的只读视图内容。
 *
 * 优先展示镜头级正文（有镜头时正文写在 `shot.description`），
 * 没有镜头时展示分集 `script`；两者都空则如实显示「（空）」。
 */
function latestVersionEpisode(project: DramaProject) {
  const episode = activeEpisodeOf(project);
  if (!episode) return [];
  if (episode.shots.length) {
    return episode.shots.map((shot) => ({
      id: shot.id,
      title: shot.title || `镜头 ${shot.order}`,
      text: [shot.description, shot.dialogue].filter(Boolean).join("\n"),
    }));
  }
  return [{ id: episode.id, title: episode.title, text: episode.script }];
}

/**
 * 把首页参考文件登记到短剧项目的 `sourceAssets`。
 *
 * 按 `storageKey` 去重：同一文件重复带入不会产生多条登记。
 */
function mergeSourceAssets(current: DramaSourceAsset[] | undefined, incoming: DramaSourceAsset[]): DramaSourceAsset[] {
  const existing = current ?? [];
  const seen = new Set(existing.map((asset) => asset.storageKey || asset.id));
  return [...existing, ...incoming.filter((asset) => !seen.has(asset.storageKey || asset.id))];
}

/** 首页创作意图里的参考文件 → 短剧 sourceAssets（异步，因为要真实上传）。 */
async function buildSourceAssets(files: IntentFile[]): Promise<{ assets: DramaSourceAsset[]; failed: string[] }> {
  const assets: DramaSourceAsset[] = [];
  const failed: string[] = [];
  for (const file of files) {
    const restored = dataUrlToFile(file);
    if (!restored) { failed.push(file.name); continue; }
    const kind = file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "image";
    try {
      const uploaded = await uploadPersistentAsset(restored, kind);
      const size = kind === "image" ? await readImageSize(restored).catch(() => null) : null;
      assets.push({
        id: `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        type: kind,
        title: file.name || "创作参考",
        storageKey: uploaded.key,
        serverUrl: uploaded.url,
        ...(uploaded.mimeType || file.type ? { mimeType: uploaded.mimeType || file.type } : {}),
        ...(size ? { width: size.width, height: size.height } : {}),
      });
    } catch {
      failed.push(file.name);
    }
  }
  return { assets, failed };
}

/**
 * 「没有关联短剧项目」的诚实提示 + 真实创建入口。
 *
 * 创建时必须带上 `sourceHandoffId`（= 画布 id 去掉 `canvas-`），
 * 后端据此把短剧 id 生成为 `drama-${sourceHandoffId}`，关联由后端自己的规则建立；
 * 绝不把画布 id 直接当短剧 id 用。
 *
 * 创建成功后由调用方 `onLinked()` 重新解析关联：`bumpAccountData()` 会通知
 * 所有账户数据 hooks 重读，因此不需要整页刷新。
 */
function ScriptUnlinkedNotice({ canvasProjectId, title, onLinked }: { canvasProjectId: string; title: string; onLinked: () => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const handoff = canvasHandoffFromProjectId(canvasProjectId);

  async function createLinkedDrama() {
    if (creating || !handoff) return;
    setCreating(true);
    setError("");
    try {
      await createDramaProject({
        title: title || "短剧项目",
        sourceHandoffId: handoff,
        summary: "由画布项目创建并关联",
      });
      bumpAccountData();
      onLinked();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建短剧项目失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mb-4">
      <Notice tone="neutral">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="flex-1">
          当前画布项目「{title}」没有关联的短剧项目，因此本页没有可保存剧本的地方
          （画布项目与短剧项目是两套数据，画布不为剧本提供存储）。
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <ControlButton size="sm" variant="primary" disabled={creating || !handoff} onClick={() => void createLinkedDrama()}>
              {creating ? "创建中…" : "创建并关联短剧项目"}
            </ControlButton>
            <Link href="/projects" className="text-xs text-studio-accent hover:underline">返回项目列表</Link>
          </span>
          {error && <span className="mt-2 block text-studio-warn">创建失败：{error}</span>}
        </span>
      </Notice>
    </div>
  );
}

/**
 * 剧本页左侧的场景导航。
 *
 * 场景来源是**真实短剧镜头**；没有镜头（或短剧项目未加载/未关联）时如实显示空态，
 * 不再回落到本地演示镜头。
 */
function ScriptSidebar({
  scenes,
  activeShotId,
  onSelect,
  loading,
}: {
  scenes: DramaShot[];
  activeShotId: string;
  onSelect: (shotId: string) => void;
  loading: boolean;
}) {
  return (
    <aside className="studio-surface h-fit p-3 xl:sticky xl:top-20" aria-label="章节与场景">
      <div className="flex items-center justify-between gap-2 px-2">
        <div>
          <p className="text-xs font-semibold text-foreground">章节与场景</p>
          <p className="mt-1 text-[10px] text-muted-foreground">剧本文档导航</p>
        </div>
        <StatusBadge>{loading ? "读取中" : `${scenes.length} 个场景`}</StatusBadge>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            第 1 集
          </p>
          <div className="flex flex-col gap-0.5">
            {scenes.map((shot, index) => (
              <button
                type="button"
                key={shot.id}
                onClick={() => onSelect(shot.id)}
                aria-current={activeShotId === shot.id ? "true" : undefined}
                className={
                  activeShotId === shot.id
                    ? "flex items-start gap-2 rounded-lg bg-muted px-2 py-2 text-left text-xs text-foreground"
                    : "flex items-start gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                <span className="w-4 pt-0.5 text-[10px] opacity-60">{String(shot.order || index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{shot.title || `镜头 ${index + 1}`}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {Math.max(1, Number(shot.duration) || 5)} 秒 · {shotStatusLabel(dramaShotStatus(shot))}
                  </span>
                </span>
              </button>
            ))}
            {scenes.length === 0 && (
              <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                {loading ? "正在读取短剧项目…" : "短剧项目里还没有镜头，正文将写入分集剧本。"}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function ScriptPanel({
  project,
  sceneTitle,
  sceneMeta,
  bodyText,
  dialogueText,
  dirty,
  saving,
  canSave,
  savedAt,
  totalSeconds,
  sceneCount,
  onBodyChange,
  onDialogueChange,
  onSave,
}: {
  project: Project | undefined;
  sceneTitle: string;
  sceneMeta: string;
  bodyText: string;
  dialogueText: string;
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  savedAt: string;
  totalSeconds: number;
  sceneCount: number;
  onBodyChange: (value: string) => void;
  onDialogueChange: (value: string) => void;
  onSave: () => void;
}) {
  if (!project) return null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="剧本"
        description="在受控阅读宽度内编辑章节、场景动作与对白，为分镜保留清晰上下文。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={dirty ? "warning" : savedAt ? "success" : "muted"}>
              {dirty ? "未保存草稿" : savedAt || "尚未保存"}
            </StatusBadge>
            <ControlButton
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={!dirty || !canSave}
              data-testid="script-save"
              aria-label={saving ? "正在保存草稿" : "保存草稿"}
            >
              <Check className="size-3.5" />
              {saving ? "保存中…" : "保存草稿"}
            </ControlButton>
          </div>
        }
      />
      <section className="studio-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 py-3 text-xs">
          <span className="font-medium text-foreground">场景 {sceneCount}</span>
          <span className="text-muted-foreground">预计时长 {formatTime(totalSeconds)}</span>
          <span className="ml-auto text-muted-foreground">{sceneMeta}</span>
        </div>
        <article className="bg-muted/20 px-4 py-7 sm:px-8 md:py-10">
          <div className="mx-auto w-full max-w-[840px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">第 1 集</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">{project.title}</h2>
            <div className="mt-8 border-l-2 border-foreground pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {sceneCount > 0 ? "场景标题" : "分集正文"}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{sceneTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{sceneMeta}</p>
            </div>
            <div className="mt-8">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">环境与动作</span>
                <textarea
                  value={bodyText}
                  onChange={(event) => onBodyChange(event.target.value)}
                  aria-label="环境与动作正文"
                  className="mt-3 min-h-[230px] w-full resize-y border-0 bg-transparent p-0 text-[15px] leading-8 text-foreground outline-none placeholder:text-muted-foreground/60"
                  placeholder="写下环境、动作、镜头节奏与人物关系。"
                />
              </label>
            </div>
            <div className="mt-8 border-t border-border pt-6">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">对白</span>
                <textarea
                  value={dialogueText}
                  onChange={(event) => onDialogueChange(event.target.value)}
                  aria-label="对白正文"
                  className="mt-3 min-h-24 w-full resize-y border-0 bg-transparent p-0 text-[15px] leading-8 text-foreground outline-none placeholder:text-muted-foreground/60"
                  placeholder="角色名：对白内容；没有对白时可填写“无台词”。"
                />
              </label>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function AssetFilterSidebar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const filters = [
    { value: "全部", label: "全部资料", count: "" },
    { value: "角色", label: "角色", count: "2" },
    { value: "场景", label: "场景", count: "3" },
    { value: "参考素材", label: "参考素材", count: "4" },
  ];

  return (
    <aside className="studio-surface h-fit p-3 xl:sticky xl:top-20" aria-label="资料筛选">
      <div className="flex items-center gap-2 px-2">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-foreground">资料筛选</p>
      </div>
      <div className="mt-3 flex flex-row gap-1 overflow-x-auto xl:flex-col xl:overflow-visible" data-mobile-scroll>
        {filters.map((filter) => (
          <button
            type="button"
            key={filter.value}
            onClick={() => onChange(filter.value)}
            aria-pressed={value === filter.value}
            className={
              value === filter.value
                ? "flex shrink-0 items-center justify-between rounded-lg bg-muted px-2.5 py-2 text-left text-xs font-medium text-foreground"
                : "flex shrink-0 items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            }
          >
            <span>{filter.label}</span>
            {filter.count && <span className="text-[10px] text-muted-foreground">{filter.count}</span>}
          </button>
        ))}
      </div>
      <p className="mt-4 hidden px-2 text-[11px] leading-5 text-muted-foreground xl:block">
        角色、场景和参考素材会被分镜重复引用，保持在同一项目上下文内。
      </p>
    </aside>
  );
}

function CharactersWorkspace({ projectId }: { projectId: string }) {
  const [filter, setFilter] = useState("全部");
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[232px_minmax(0,1fr)]">
      <AssetFilterSidebar value={filter} onChange={setFilter} />
      <CharactersPanel projectId={projectId} filter={filter} />
    </div>
  );
}

function CharactersPanel({
  projectId,
  filter,
}: {
  projectId: string;
  filter: string;
}) {
  const { state } = useStudio();
  const [model, setModel] = useState("nova-image");
  const [style, setStyle] = useState("电影写实");
  const [ratio, setRatio] = useState("4:5");
  const [pose, setPose] = useState("自然站姿");
  const [expression, setExpression] = useState("克制、若有所思");
  const [notice, setNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const projectAssets = state.assets.filter((asset) => asset.projectIds.includes(projectId));
  const characters = [
    {
      id: "linxia",
      name: "林夏",
      role: "主角",
      age: "28 岁",
      src: media.portrait,
      detail: "离开故乡七年后，在极夜结束前回到这里。",
      shots: 8,
    },
    {
      id: "shen-chuan",
      name: "沈川",
      role: "旧友",
      age: "31 岁",
      src: media.dancer,
      detail: "守着山谷里的旧站台，记得林夏没有寄出的信。",
      shots: 5,
    },
  ];
  const scenes = [
    { name: "车站", detail: "空旷站台、长椅与远处的一盏灯", src: media.auroraCover },
    { name: "林间小路", detail: "积雪覆盖的林间，极光穿过树梢", src: media.forest },
    { name: "旧屋", detail: "木桌、窗帘与没有寄出的信", src: undefined },
  ];
  const referenceAssets = projectAssets.filter((asset) => asset.kind === "image" || asset.kind === "scene");
  const showCharacters = filter === "全部" || filter === "角色";
  const showScenes = filter === "全部" || filter === "场景";
  const showReferences = filter === "全部" || filter === "参考素材";

  function createVariant() {
    setNotice(`${style} · ${pose} · ${expression} 的角色变体已加入生成队列。`);
  }

  function chooseMaterial(kind: string) {
    setAddOpen(false);
    setNotice(`已打开“${kind}”资料入口，后续生成会沿用当前项目上下文。`);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="角色与场景"
        description="统一管理会被分镜反复引用的视觉信息，参考素材与生成参数保持在同一工作区。"
        actions={
          <ControlButton variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" />
            添加资料
          </ControlButton>
        }
      />
      {notice && (
        <Notice tone="accent">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </Notice>
      )}

      {showCharacters && (
        <section>
          <SectionHeading title="角色" description="头像、身份和关联镜头会作为生成参考保留。" />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {characters.map((character) => (
              <article key={character.id} className="studio-surface p-3.5">
                <div className="flex gap-4">
                  <MediaThumb
                    src={character.src}
                    alt={`${character.name} 角色参考图`}
                    fallback={character.name}
                    className="size-28 shrink-0 sm:size-32"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">{character.name}</h2>
                        <p className="mt-1 text-xs text-studio-accent">{character.role} · {character.age}</p>
                      </div>
                      <IconAction label={`${character.name} 更多操作`} onClick={() => setNotice(`已打开${character.name}的更多操作。`)}>
                        <MoreHorizontal />
                      </IconAction>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">{character.detail}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">关联镜头 {character.shots} 个</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                  <ControlButton variant="secondary" size="sm" onClick={() => setNotice(`正在查看${character.name}的完整资料。`)}>
                    查看资料
                  </ControlButton>
                  <ControlButton variant="ghost" size="sm" onClick={() => setNotice(`已进入${character.name}的编辑状态。`)}>
                    <Pencil className="size-3.5" />
                    编辑
                  </ControlButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {showScenes && (
        <section>
          <SectionHeading title="场景" description="为每个场景保留光线、材质和镜头参考。" />
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {scenes.map((scene, index) => (
              <article key={scene.name} className="studio-surface overflow-hidden">
                <MediaThumb
                  src={scene.src}
                  alt={`${scene.name} 场景参考图`}
                  fallback="暂无参考图"
                  className="aspect-[16/9]"
                />
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex size-7 items-center justify-center rounded bg-muted text-xs text-studio-accent">{String(index + 1).padStart(2, "0")}</span>
                    <IconAction label={`${scene.name} 更多操作`} onClick={() => setNotice(`已打开${scene.name}的更多操作。`)}>
                      <MoreHorizontal />
                    </IconAction>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">{scene.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{scene.detail}</p>
                  <ControlButton variant="ghost" size="sm" className="mt-3 h-7 px-0 text-xs" onClick={() => setNotice(`${scene.name}的参考素材入口已准备。`)}>
                    {scene.src ? <ImageIcon className="size-3.5" /> : <Upload className="size-3.5" />}
                    {scene.src ? "查看参考素材" : "添加参考素材"}
                  </ControlButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {showReferences && (
        <section>
          <SectionHeading title="参考素材" description="来自当前项目素材库的可复用画面。" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {referenceAssets.map((asset) => (
              <article key={asset.id} className="studio-surface overflow-hidden">
                <MediaThumb src={asset.src} alt={asset.title} fallback={asset.fallback} className="aspect-[4/3]" />
                <div className="p-3">
                  <p className="truncate text-xs font-medium text-foreground">{asset.title}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{asset.dimensions ?? asset.size}</p>
                </div>
              </article>
            ))}
            {referenceAssets.length === 0 && (
              <div className="col-span-full flex min-h-28 items-center justify-center border border-dashed border-border text-xs text-muted-foreground">还没有参考素材。</div>
            )}
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="studio-surface p-4 sm:p-5">
          <SectionHeading
            title="角色生成参数"
            description="从角色参考图生成同一人物的不同姿态与情绪。"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label="模型"
              value={model}
              onChange={setModel}
              options={[
                { value: "nova-image", label: "Nova Image 2" },
                { value: "line-art", label: "Line Art Studio" },
              ]}
            />
            <SelectField
              label="风格"
              value={style}
              onChange={setStyle}
              options={[
                { value: "电影写实", label: "电影写实" },
                { value: "冷调胶片", label: "冷调胶片" },
                { value: "概念设定", label: "概念设定" },
              ]}
            />
            <SelectField
              label="比例"
              value={ratio}
              onChange={setRatio}
              options={[
                { value: "1:1", label: "1:1" },
                { value: "4:5", label: "4:5" },
                { value: "16:9", label: "16:9" },
              ]}
            />
            <SelectField
              label="姿态"
              value={pose}
              onChange={setPose}
              options={[
                { value: "自然站姿", label: "自然站姿" },
                { value: "回头望向镜头", label: "回头望向镜头" },
                { value: "行走中", label: "行走中" },
              ]}
            />
            <SelectField
              label="表情"
              value={expression}
              onChange={setExpression}
              options={[
                { value: "克制、若有所思", label: "克制、若有所思" },
                { value: "平静", label: "平静" },
                { value: "微笑", label: "微笑" },
              ]}
            />
          </div>
        </div>
        <aside className="studio-surface h-fit p-4 lg:sticky lg:top-20">
          <SectionHeading title="生成摘要" />
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-2">
            <div className="flex items-center justify-between gap-3 py-2 text-xs"><span className="text-muted-foreground">当前角色</span><span className="font-medium text-foreground">林夏</span></div>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 py-2 text-xs"><span className="text-muted-foreground">参考图</span><span className="font-medium text-foreground">2 个</span></div>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 py-2 text-xs"><span className="text-muted-foreground">预计消耗</span><span className="font-medium text-foreground">12 积分</span></div>
          </div>
          <ControlButton variant="primary" className="mt-3 w-full" onClick={createVariant}>
            <Sparkles className="size-3.5" />
            生成角色变体
          </ControlButton>
        </aside>
      </section>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加资料"
        description="选择要加入当前项目视觉资料库的类型。"
        footer={<ControlButton variant="ghost" onClick={() => setAddOpen(false)}>取消</ControlButton>}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {["角色", "场景", "参考素材"].map((kind) => (
            <button
              type="button"
              key={kind}
              onClick={() => chooseMaterial(kind)}
              className="flex min-h-24 flex-col items-start justify-between rounded-lg border border-border bg-card p-3 text-left hover:bg-muted"
            >
              <span className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
                {kind === "角色" ? <Users className="size-4" /> : kind === "场景" ? <ImageIcon className="size-4" /> : <Upload className="size-4" />}
              </span>
              <span className="text-xs font-medium text-foreground">添加{kind}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** 分镜页左侧的镜头列表（真实短剧镜头）。 */
function ShotSidebar({
  scenes,
  activeShotId,
  onSelect,
  loading,
}: {
  scenes: DramaShot[];
  activeShotId: string;
  onSelect: (shotId: string) => void;
  loading: boolean;
}) {
  return (
    <aside className="studio-surface h-fit p-3 xl:sticky xl:top-20" aria-label="分镜镜头列表">
      <div className="flex items-center justify-between gap-2 px-2">
        <div>
          <p className="text-xs font-semibold text-foreground">镜头列表</p>
          <p className="mt-1 text-[10px] text-muted-foreground">短剧项目里的真实镜头</p>
        </div>
        <StatusBadge>{loading ? "读取中" : `${scenes.length} 个`}</StatusBadge>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">第 1 集</p>
          <div className="flex flex-col gap-0.5">
            {scenes.map((shot, index) => {
              const status = dramaShotStatus(shot);
              return (
                <button
                  type="button"
                  key={shot.id}
                  onClick={() => onSelect(shot.id)}
                  aria-current={activeShotId === shot.id ? "true" : undefined}
                  className={
                    activeShotId === shot.id
                      ? "rounded-lg border border-foreground bg-muted px-2 py-2 text-left"
                      : "rounded-lg border border-transparent px-2 py-2 text-left hover:bg-muted"
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-[10px] text-muted-foreground">{String(shot.order || index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{shot.title || `镜头 ${index + 1}`}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 pl-6">
                    <StatusBadge tone={shotStatusTone(status)} className="px-1.5 text-[10px]">{shotStatusLabel(status)}</StatusBadge>
                    <span className="text-[10px] text-muted-foreground">{Math.max(1, Number(shot.duration) || 5)} 秒</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        {scenes.length === 0 && (
          <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
            {loading ? "正在读取短剧项目的分镜…" : "短剧项目的当前分集还没有镜头，可以在这里添加。"}
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * 分镜工作区。
 *
 * 镜头列表来自**真实短剧项目的当前分集**；「添加镜头」也真实写回短剧项目
 * （此前只 dispatch 本地 `ADD_SHOT`，刷新即消失）。
 * 没有关联短剧项目时如实提示，不再用本地演示镜头假装有分镜。
 */
function StoryboardWorkspace({ project }: { project: Project | undefined }) {
  const canvasProjectId = project?.id ?? "";
  const drama = useLinkedDramaProject(canvasProjectId);
  const dramaProject = drama.project;
  const episode = useMemo(() => activeEpisodeOf(dramaProject), [dramaProject]);
  const scenes = useMemo<DramaShot[]>(() => (dramaProject ? (episode?.shots ?? []) : []), [dramaProject, episode]);
  const [activeShotId, setActiveShotId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newShotTitle, setNewShotTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const activeShot = scenes.find((item) => item.id === activeShotId) ?? scenes[0];

  useEffect(() => {
    setActiveShotId((current) => (scenes.some((item) => item.id === current) ? current : (scenes[0]?.id ?? "")));
  }, [scenes]);

  /** 新增镜头：真实写回短剧项目，成功后才更新选中项。 */
  async function addShot() {
    const title = newShotTitle.trim();
    if (!title || busy || !dramaProject || !episode) return;
    setBusy(true);
    setActionError("");
    try {
      const nextOrder = scenes.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0) + 1;
      const draft: DramaShot = {
        id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        order: nextOrder,
        title,
        description: "待补充镜头动作与环境描述。",
        sourceText: "",
        shotBoundary: "",
        dialogue: "",
        narration: "",
        utterances: [],
        imagePrompt: "",
        videoPrompt: "",
        cameraMotion: "",
        duration: 5,
        characterIds: [],
        propIds: [],
        clueIds: [],
        storyboardStatus: "idle",
        generationStatus: "idle",
      };
      const saved = await drama.save((current) => ({
        ...current,
        episodes: current.episodes.map((item) => item.id === episode.id ? { ...item, shots: [...item.shots, draft] } : item),
      }));
      setNewShotTitle("");
      setAddOpen(false);
      setActiveShotId(draft.id);
      // 用服务端返回值确认：没有写进去就必须如实报错，而不是假装添加成功。
      if (!activeEpisodeOf(saved)?.shots.some((item) => item.id === draft.id)) {
        setActionError("服务端没有保存这个镜头，请重试。");
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "添加镜头失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[232px_minmax(0,1fr)]">
      <ShotSidebar
        scenes={scenes}
        activeShotId={activeShotId}
        onSelect={setActiveShotId}
        loading={drama.state === "loading"}
      />
      <div className="min-w-0">
        {drama.state === "unlinked" && (
          <ScriptUnlinkedNotice canvasProjectId={canvasProjectId} title={project?.title ?? ""} onLinked={() => void drama.reload()} />
        )}
        {drama.state === "error" && (
          <div className="mb-4">
            <Notice tone="warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                短剧项目读取失败：{drama.message}
                <button type="button" className="ml-2 underline" onClick={() => void drama.reload()}>重试</button>
              </span>
            </Notice>
          </div>
        )}
        {actionError && (
          <div className="mb-4">
            <Notice tone="warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {actionError}
            </Notice>
          </div>
        )}
        <StoryboardPanel
          shot={activeShot}
          canvasProjectId={canvasProjectId}
          drama={drama}
          episodeId={episode?.id ?? ""}
          onAddShot={() => setAddOpen(true)}
          adding={busy}
        />
      </div>
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加镜头"
        description="镜头会写入真实短剧项目的当前分集。"
        footer={
          <>
            <ControlButton variant="ghost" onClick={() => setAddOpen(false)}>取消</ControlButton>
            <ControlButton variant="primary" disabled={busy || !dramaProject} onClick={() => void addShot()}>
              {busy ? "写入中…" : "添加镜头"}
            </ControlButton>
          </>
        }
      >
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">镜头名称</span>
          <input
            autoFocus
            value={newShotTitle}
            onChange={(event) => setNewShotTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") void addShot();
            }}
            placeholder="例如：站台上的回头"
            className="studio-field h-10 border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
          />
        </label>
      </Modal>
    </div>
  );
}

/**
 * 分镜面板。
 *
 * 背景（本轮复现的真实缺陷）：`generateShot()` 调的是 `addDemoTask(...)`
 * ——只把本地 `state.credits` 减一笔、往本地任务列表塞一条记录，
 * **从不调用真实生成接口**。于是「已创建生成任务」是假的：没有真实任务、
 * 没有真实计费、没有结果，刷新后什么都不剩。
 *
 * 现在：真实 `POST /api/image-tasks`（经 `generation.createImage`，保留其账号竞态防护），
 * 把真实任务 id 与状态写回**短剧镜头**（`storyboardTaskId` / `storyboardStatus`），
 * 并在任务终态时把成功结果（`storyboardImageUrl` 等）或真实错误持久化到同一个镜头。
 */
function StoryboardPanel({
  shot,
  canvasProjectId,
  drama,
  episodeId,
  onAddShot,
  adding,
}: {
  shot: DramaShot | undefined;
  canvasProjectId: string;
  drama: ReturnType<typeof useLinkedDramaProject>;
  episodeId: string;
  onAddShot: () => void;
  adding: boolean;
}) {
  const { state, estimateCredits, liveModels, liveReady, defaultModels } = useStudio();
  const generation = useGeneration();
  const imageModels = useMemo(
    () => (liveModels.length ? filterModelsByCapability(liveModels, "image") : []),
    [liveModels],
  );
  const [modelId, setModelId] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState("高清");
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [favoriteCandidateIds, setFavoriteCandidateIds] = useState<string[]>([]);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "accent" | "warning" | "neutral"; text: string } | null>(null);
  /** 版本冲突（后端 409）：草稿（修改方向备注）保留，另给查看最新版本 / 复制草稿入口。 */
  const [conflict, setConflict] = useState("");
  /** 「查看最新版本」读到的服务端快照，只读展示。 */
  const [latestProject, setLatestProject] = useState<DramaProject | null>(null);
  /** 已写回终态的 任务 id，避免轮询结果重复触发 PATCH。 */
  const settledRef = useRef<Set<string>>(new Set());
  const estimatedCredits = estimateCredits(modelId, { ratio, quality, count: 1 });
  /**
   * 项目显示名。
   *
   * 早先写死「projectId === 'aurora' ? '极光之后' : projectId」，
   * 于是真实项目（UUID）在这个面板里显示的是一串 ID，用户看不懂；
   * 这里按真实项目列表取标题，取不到才回落到 ID。
   */
  const projectTitle = state.projects.find((item) => item.id === canvasProjectId)?.title || canvasProjectId;
  /** 短剧分镜图是真实产物地址；没有产物时才回落到项目封面。 */
  const shotImage = shot?.storyboardImageUrl || projectTitle;

  // 模型目录来自会话，默认模型取后端 defaultModels，不再写死演示模型 id。
  useEffect(() => {
    if (!imageModels.length) return;
    setModelId((current) => imageModels.some((item) => item.id === current) ? current : defaultModelFor("image", state.sessionSettings, imageModels));
  }, [imageModels, state.sessionSettings]);

  useEffect(() => {
    setSelectedCandidate(shot?.storyboardImageUrl ?? "");
    setPreviewOpen(false);
  }, [shot?.id, shot?.storyboardImageUrl]);

  /**
   * 已提交任务的结果回写。
   *
   * 只在任务进入终态时执行一次：成功写入 `storyboardStatus: 'success'` 与真实产物地址，
   * 失败写入 `'error'` 与后端的真实错误原文。**不编造进度、不编造计费**。
   */
  const shotId = shot?.id ?? "";
  const taskId = shot?.storyboardTaskId ?? "";
  useEffect(() => {
    if (!shotId || !taskId) return;
    if (settledRef.current.has(taskId)) return;
    const task = generation.tasks.find((item) => item.id === taskId);
    if (!task || !isTerminalStatus(task.status)) return;
    settledRef.current.add(taskId);
    const media = task.media?.[0];
    const success = task.status === "success" && Boolean(media?.url);
    const message = task.error || (task.needsReview ? `上游返回待人工确认：${task.reviewReason ?? "需要人工检查"}` : "任务失败");
    void drama.save((current) => ({
      ...current,
      episodes: current.episodes.map((episode) => episode.id !== episodeId ? episode : {
        ...episode,
        shots: episode.shots.map((item) => item.id !== shotId ? item : success
          ? {
              ...item,
              storyboardStatus: "success" as const,
              storyboardTaskId: task.id,
              storyboardImageUrl: media!.url,
              ...(media!.width ? { storyboardImageWidth: media!.width } : {}),
              ...(media!.height ? { storyboardImageHeight: media!.height } : {}),
              storyboardError: undefined,
            }
          : {
              ...item,
              storyboardStatus: "error" as const,
              storyboardTaskId: task.id,
              storyboardError: message,
            }),
      }),
    })).then(() => {
      const points = Number(task.pointsCost) || 0;
      setNotice(success
        ? { tone: "accent", text: `镜头“${shot?.title ?? ""}”生成完成，已写入短剧项目${points ? `，本次实际消耗 ${points} 积分` : ""}。` }
        : { tone: "warning", text: `镜头“${shot?.title ?? ""}”生成失败：${message}${points ? `（已计费 ${points} 积分）` : ""}` });
    }).catch((reason: unknown) => {
      // 结果写回失败必须如实报告：否则界面显示成功而服务端没有产物。
      settledRef.current.delete(taskId);
      setNotice({ tone: "warning", text: `生成任务已结束，但结果写回短剧项目失败：${reason instanceof Error ? reason.message : "未知错误"}` });
    });
  }, [drama, episodeId, generation.tasks, shot?.title, shotId, taskId]);

  if (!shot) {
    return (
      <div className="min-w-0">
        <PageHeader
          title="分镜"
          description="选择候选结果作为当前镜头，失败镜头可以单独重试。"
          actions={<ControlButton variant="secondary" size="sm" disabled={adding} onClick={onAddShot}><Plus className="size-3.5" />添加镜头</ControlButton>}
        />
        <EmptyState
          title="还没有分镜"
          description={drama.state === "unlinked"
            ? "当前画布项目没有关联的短剧项目，因此没有可写入的分镜存储。"
            : drama.state === "loading"
              ? "正在读取短剧项目的分镜。"
              : "短剧项目的当前分集还没有镜头，可以先在剧本页补充正文或直接添加镜头。"}
          action={<ControlButton variant="primary" disabled={adding || !drama.project} onClick={onAddShot}><Plus className="size-3.5" />添加第一个镜头</ControlButton>}
        />
      </div>
    );
  }

  const currentShot = shot;
  const status = dramaShotStatus(currentShot);

  /**
   * 真实分镜生成。
   *
   * 关键链路：`generation.createImage()` → `POST /api/image-tasks` → 拿到真实任务 id
   * → 立刻把 id 与 `running` 写回短剧镜头。任何一步失败都如实报错，不写「已生成」。
   */
  async function generateShot() {
    if (submitting) return;
    if (!drama.project || !episodeId) {
      setNotice({ tone: "warning", text: "当前画布项目没有关联的短剧项目，无法生成分镜：生成结果没有可写入的地方。" });
      return;
    }
    if (!liveReady) {
      setNotice({ tone: "warning", text: "后端未就绪或未登录，无法创建真实生成任务。请先登录后重试。" });
      return;
    }
    const prompt = currentShot.imagePrompt?.trim() || currentShot.description?.trim() || currentShot.title;
    if (!prompt) {
      setNotice({ tone: "warning", text: "这个镜头没有画面提示词或描述，请先在剧本页补全后再生成。" });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const task = await generation.createImage({
        prompt,
        model: modelId || undefined,
        ratio,
        quality,
        count: 1,
        title: `分镜生成 · ${currentShot.title}`,
        projectId: drama.dramaProjectId ?? undefined,
        // 短剧来源，便于后台按来源筛选与统计。
        surface: "drama",
        clientRequestId: newClientRequestId("drama-storyboard"),
      });
      /**
       * 写回真实任务 id。这里也核对返回值：写不进去就必须报错，
       * 否则界面会显示「已创建任务」而短剧项目里没有记录。
       */
      const saved = await drama.save((current) => ({
        ...current,
        episodes: current.episodes.map((episode) => episode.id !== episodeId ? episode : {
          ...episode,
          shots: episode.shots.map((item) => item.id !== currentShot.id ? item : {
            ...item,
            storyboardTaskId: task.id,
            storyboardStatus: "running" as const,
            storyboardError: undefined,
          }),
        }),
      }));
      const persisted = activeEpisodeOf(saved)?.shots.find((item) => item.id === currentShot.id);
      if (persisted?.storyboardTaskId !== task.id) {
        setNotice({ tone: "warning", text: `任务 ${task.id} 已创建，但任务标识未能写入短剧项目（服务端返回的仍是旧值）。请在任务中心查看该任务，稍后重试写回。` });
        return;
      }
      setNotice({ tone: "accent", text: `已创建真实生成任务 ${task.id}（模型 ${task.model || modelId || "后端默认"}）。任务完成后结果会自动写入该镜头。` });
    } catch (reason) {
      /**
       * 任务创建成功但任务 id 写回撞上版本冲突时，**不能重试覆盖**：
       * 说明别的窗口先改了项目，重试会把它覆盖掉。如实报告冲突并保留现场，
       * 由用户选择「查看最新版本」后再决定怎么写回。
       */
      if (isDramaConflict(reason)) {
        setConflict(DRAMA_CONFLICT_MESSAGE);
        setNotice({ tone: "warning", text: `分镜任务未能写回短剧项目：${DRAMA_CONFLICT_MESSAGE}。任务本身可能在后台已创建，请到任务中心核对后再重试写回。` });
        return;
      }
      const message = reason instanceof Error ? reason.message : "生成任务创建失败";
      setNotice({ tone: "warning", text: `生成任务创建失败：${message}` });
    } finally {
      setSubmitting(false);
    }
  }

  /** 查看服务端最新版本：只读取，绝不覆盖本地待写回内容。 */
  async function viewLatestVersion() {
    setConflict("");
    try {
      setLatestProject(await getDramaProject(drama.dramaProjectId ?? ""));
    } catch (reason) {
      setNotice({ tone: "warning", text: `读取最新版本失败：${reason instanceof Error ? reason.message : "未知错误"}` });
    }
  }

  /** 复制当前镜头的待写回内容，避免冲突时丢失。 */
  async function copyDraft() {
    const draft = [
      `镜头：${currentShot.title}`,
      currentShot.description ? `环境与动作：${currentShot.description}` : "",
      currentShot.dialogue ? `对白：${currentShot.dialogue}` : "",
      editNote ? `修改方向：${editNote}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(draft);
      setNotice({ tone: "accent", text: "当前镜头内容已复制到剪贴板。" });
    } catch {
      setNotice({ tone: "warning", text: "复制失败：浏览器拒绝了剪贴板访问，请手动选中内容复制。" });
    }
  }

  function selectCandidate(candidateId: string) {
    setSelectedCandidate(candidateId);
  }

  function toggleFavorite(candidateId: string) {
    setFavoriteCandidateIds((current) =>
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId],
    );
  }

  function saveCandidateEdit() {
    setEditingCandidateId(null);
    setEditNote("");
    setNotice({ tone: "neutral", text: "修改方向尚未接入真实生成参数，本次不会写入短剧项目。" });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="分镜"
        description="在当前镜头下比较候选画面，保留选用结果并追踪每个生成任务。"
        actions={
          <>
            <ControlButton variant="secondary" size="sm" disabled={adding} onClick={onAddShot}>
              <Plus className="size-3.5" />
              添加镜头
            </ControlButton>
            <ControlButton variant="primary" size="sm" disabled={submitting || !drama.project} onClick={() => void generateShot()} data-testid="storyboard-generate" aria-label="生成当前镜头">
              <Sparkles className="size-3.5" />
              {submitting ? "提交中…" : status === "需重试" ? "重试当前镜头" : "生成当前镜头"}
            </ControlButton>
          </>
        }
      />
      {notice && (
        <Notice tone={notice.tone === "accent" ? "accent" : "warning"}>
          <Clock3 className="mt-0.5 size-3.5 shrink-0" />
          {notice.text}
        </Notice>
      )}
      {conflict && (
        <Notice tone="warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1" data-testid="storyboard-conflict">
            {conflict}
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <ControlButton size="sm" variant="secondary" onClick={() => void viewLatestVersion()} data-testid="storyboard-view-latest">
                查看最新版本
              </ControlButton>
              <ControlButton size="sm" variant="secondary" onClick={() => void copyDraft()} data-testid="storyboard-copy-draft">
                复制草稿
              </ControlButton>
            </span>
          </span>
        </Notice>
      )}
      {latestProject && (
        <section className="studio-surface overflow-hidden" data-testid="storyboard-latest-version">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-foreground">服务端最新版本（只读）</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {latestProject.title} · 版本 {formatSavedAt(latestProject.updatedAt)}
              </p>
            </div>
            <ControlButton size="sm" variant="ghost" onClick={() => setLatestProject(null)}>收起</ControlButton>
          </div>
          <div className="max-h-72 overflow-auto px-4 py-3">
            {latestVersionEpisode(latestProject).map((item) => (
              <article key={item.id} className="border-b border-border/70 py-3 last:border-b-0">
                <p className="text-xs font-medium text-foreground">{item.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{item.text || "（空）"}</p>
              </article>
            ))}
          </div>
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            这里只展示服务端内容，不会覆盖本地待写回的修改。
          </p>
        </section>
      )}
      <section className="studio-surface min-w-0 p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">镜头 {String(currentShot.order || 1).padStart(2, "0")}</span>
              <StatusBadge tone={shotStatusTone(status)}>{shotStatusLabel(status)}</StatusBadge>
              {currentShot.storyboardTaskId && (
                <span className="text-[11px] text-muted-foreground">任务 {currentShot.storyboardTaskId}</span>
              )}
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground">{currentShot.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{currentShot.description}</p>
            {currentShot.imagePrompt && (
              <p className="mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">画面提示词：{currentShot.imagePrompt}</p>
            )}
            {currentShot.storyboardError && (
              <p className="mt-2 max-w-2xl text-[11px] leading-5 text-studio-warn">上次失败原因：{currentShot.storyboardError}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge>{Math.max(1, Number(currentShot.duration) || 5)} 秒</StatusBadge>
            <ControlButton variant="ghost" size="sm" disabled={submitting || !drama.project} onClick={() => void generateShot()}>
              <RotateCcw className="size-3.5" />
              重试
            </ControlButton>
          </div>
        </div>
        <div className="mt-5 grid min-w-0 gap-5 border-t border-border pt-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">候选结果</p>
                <p className="mt-1 text-[11px] text-muted-foreground">候选来自该镜头真实的分镜产物（写入短剧项目字段）。</p>
              </div>
              <StatusBadge>{currentShot.storyboardImageUrl ? "1 张候选" : "0 张候选"}</StatusBadge>
            </div>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              {currentShot.storyboardImageUrl && (
                <article
                  className={
                    selectedCandidate === currentShot.storyboardImageUrl
                      ? "flex min-w-0 flex-col overflow-hidden border border-foreground bg-muted/50 ring-1 ring-foreground"
                      : "flex min-w-0 flex-col overflow-hidden border border-border bg-background"
                  }
                >
                  <button
                    type="button"
                    onClick={() => selectCandidate(currentShot.storyboardImageUrl!)}
                    aria-label={`选用${currentShot.title}分镜图`}
                    className="group relative block w-full text-left"
                  >
                    <MediaThumb
                      src={currentShot.storyboardImageUrl}
                      alt={`${currentShot.title} 分镜图`}
                      fallback={currentShot.title}
                      className="aspect-video"
                    />
                    <span className="absolute left-2 top-2 rounded bg-studio-ink/80 px-1.5 py-0.5 text-[10px] text-studio-ink-foreground">
                      {selectedCandidate === currentShot.storyboardImageUrl ? "当前选用" : "分镜产物"}
                    </span>
                  </button>
                  <div className="flex flex-1 flex-col gap-2.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{currentShot.title} · 分镜图</p>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          {currentShot.storyboardTaskId ? `任务 ${currentShot.storyboardTaskId}` : "已写入短剧项目"}
                        </p>
                      </div>
                      {selectedCandidate === currentShot.storyboardImageUrl && (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground">
                          <Check className="size-3.5" />
                          已选用
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 border-y border-border/70 py-2 text-[10px]">
                      <span className="border-r border-border/70 pr-2 text-muted-foreground"><span className="block">模型</span><span className="mt-1 block truncate font-medium text-foreground">{modelId || "后端默认"}</span></span>
                      <span className="border-r border-border/70 px-2 text-muted-foreground"><span className="block">尺寸</span><span className="mt-1 block font-medium text-foreground">{currentShot.storyboardImageWidth && currentShot.storyboardImageHeight ? `${currentShot.storyboardImageWidth}×${currentShot.storyboardImageHeight}` : "—"}</span></span>
                      <span className="pl-2 text-muted-foreground"><span className="block">状态</span><span className="mt-1 block font-medium text-foreground">{shotStatusLabel(status)}</span></span>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border/70 pt-2">
                      <ControlButton type="button" variant={selectedCandidate === currentShot.storyboardImageUrl ? "secondary" : "primary"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => selectCandidate(currentShot.storyboardImageUrl!)}>
                        <Check className="size-3" />
                        {selectedCandidate === currentShot.storyboardImageUrl ? "已选用" : "选用"}
                      </ControlButton>
                      <a href={currentShot.storyboardImageUrl} download className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <Download className="size-3" />
                        下载
                      </a>
                      <ControlButton type="button" variant="ghost" size="sm" className={favoriteCandidateIds.includes(currentShot.id) ? "h-7 px-2 text-[11px] text-studio-accent" : "h-7 px-2 text-[11px]"} onClick={() => toggleFavorite(currentShot.id)} aria-pressed={favoriteCandidateIds.includes(currentShot.id)}>
                        <Heart className="size-3" fill={favoriteCandidateIds.includes(currentShot.id) ? "currentColor" : "none"} />
                        {favoriteCandidateIds.includes(currentShot.id) ? "已收藏" : "收藏"}
                      </ControlButton>
                    </div>
                  </div>
                </article>
              )}
              {!currentShot.storyboardImageUrl && (
                <div className="col-span-full flex min-h-40 flex-col items-center justify-center border border-dashed border-border px-5 text-center">
                  <ImageIcon className="size-5 text-muted-foreground" />
                  <p className="mt-2 text-xs font-medium text-foreground">还没有分镜画面</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {drama.project
                      ? "点击“生成当前镜头”会提交真实图片生成任务，完成后把结果写回这个镜头。"
                      : "当前画布项目没有关联的短剧项目，没有可写入的分镜存储。"}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">分镜图预览</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {selectedCandidate ? "展示当前选用的真实分镜产物。" : "选用一张分镜产物后即可在这里预览。"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <ControlButton type="button" variant={previewOpen ? "secondary" : "primary"} size="sm" disabled={!selectedCandidate} onClick={() => setPreviewOpen((value) => !value)}>
                    <Play className="size-3.5" />
                    {previewOpen ? "收起预览" : "查看分镜图"}
                  </ControlButton>
                  <ControlButton type="button" variant="ghost" size="sm" aria-pressed={soundEnabled} onClick={() => setSoundEnabled((value) => !value)}>
                    {soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                    {soundEnabled ? "声音已开" : "静音"}
                  </ControlButton>
                </div>
              </div>
              {previewOpen && selectedCandidate && (
                <div className="motion-fade mt-3 overflow-hidden border border-border bg-studio-workspace">
                  <MediaThumb
                    key={`${currentShot.id}-${selectedCandidate}`}
                    src={selectedCandidate}
                    alt={`${currentShot.title}分镜图`}
                    fallback={currentShot.title}
                    className="aspect-video"
                  />
                  <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-studio-ink-muted">
                    <span className="truncate">镜头 {String(currentShot.order || 1).padStart(2, "0")} · {currentShot.title}</span>
                    <span className="shrink-0">真实产物</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <aside className="h-fit lg:sticky lg:top-20">
            <div className="border-t border-border pt-3 lg:border-t-0 lg:pt-0">
              <p className="text-xs font-semibold text-foreground">镜头信息</p>
              <div className="mt-2 border-t border-border/70">
                <div className="flex items-start justify-between gap-5 border-b border-border/70 py-3">
                  <span className="shrink-0 text-xs text-muted-foreground">台词</span>
                  <span className="max-w-[240px] text-right text-xs leading-5 text-foreground">{currentShot.dialogue || "无台词"}</span>
                </div>
                <div className="flex items-center justify-between gap-5 border-b border-border/70 py-3">
                  <span className="text-xs text-muted-foreground">角色 / 道具</span>
                  <span className="text-xs font-medium text-foreground">{(currentShot.characterIds?.length ?? 0)} / {(currentShot.propIds?.length ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between gap-5 border-b border-border/70 py-3">
                  <span className="text-xs text-muted-foreground">所属项目</span>
                  <span className="max-w-[180px] truncate text-right text-xs font-medium text-foreground">{projectTitle}</span>
                </div>
                <div className="flex items-center justify-between gap-5 border-b border-border/70 py-3">
                  <span className="text-xs text-muted-foreground">短剧项目</span>
                  <span className="max-w-[180px] truncate text-right text-xs font-medium text-foreground">{drama.dramaProjectId ?? "未关联"}</span>
                </div>
                <div className="flex items-center justify-between gap-5 py-3">
                  <span className="text-xs text-muted-foreground">任务状态</span>
                  <StatusBadge tone={shotStatusTone(status)}>{shotStatusLabel(status)}</StatusBadge>
                </div>
              </div>
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">生成参数</p>
                <span className="text-[10px] text-muted-foreground">来自后台模型目录</span>
              </div>
              <div className="mt-3 flex flex-col gap-2.5">
                <SelectField
                  label="模型"
                  value={modelId}
                  onChange={setModelId}
                  disabled={!imageModels.length}
                  hint={imageModels.length ? undefined : "会话未返回可用的图片模型，无法提交真实生成。"}
                  options={imageModels.length
                    ? imageModels.map((item) => ({ value: item.id, label: `${item.shortName} · ${item.creditCost} 积分/次` }))
                    : [{ value: "", label: "无可用模型" }]}
                />
                <div className="grid grid-cols-2 gap-2">
                  <SelectField
                    label="比例"
                    value={ratio}
                    onChange={setRatio}
                    options={["16:9", "9:16", "1:1"].map((value) => ({ value, label: value }))}
                  />
                  <SelectField
                    label="质量"
                    value={quality}
                    onChange={setQuality}
                    options={["auto", "low", "medium", "high"].map((value) => ({ value, label: qualityLabel(value) }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-2 text-xs">
                  <span className="text-muted-foreground">按后台定价估算</span>
                  <span className="font-medium text-foreground">{estimatedCredits} 积分</span>
                </div>
                <p className="text-[10px] leading-5 text-muted-foreground">
                  实际扣费以任务返回为准；估算为 0 表示后台未对该模型单独定价。
                  {!liveReady && " 当前后端不可用或未登录，提交按钮会拒绝创建任务。"}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>
      <Modal
        open={Boolean(editingCandidateId)}
        onClose={() => setEditingCandidateId(null)}
        title="修改分镜方向"
        description="修改方向尚未接入真实生成参数，本窗口不会写入短剧项目。"
        footer={
          <>
            <ControlButton variant="ghost" onClick={() => setEditingCandidateId(null)}>取消</ControlButton>
            <ControlButton variant="primary" onClick={saveCandidateEdit}><Check className="size-3.5" />关闭</ControlButton>
          </>
        }
      >
        <label className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">修改描述</span>
          <textarea
            autoFocus
            value={editNote}
            onChange={(event) => setEditNote(event.target.value)}
            placeholder="例如：保留人物构图，把光线改成更冷的蓝色，增加雪雾。"
            className="studio-field min-h-32 resize-y border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/15"
          />
        </label>
      </Modal>
    </div>
  );
}

function CutSidebar({
  shots,
  activeShotId,
  onSelect,
}: {
  shots: Shot[];
  activeShotId: string;
  onSelect: (shotId: string) => void;
}) {
  const totalSeconds = shots.reduce((sum, shot) => sum + parseDuration(shot.duration), 0);
  return (
    <aside className="studio-surface h-fit p-3 xl:sticky xl:top-20" aria-label="成片镜头顺序">
      <div className="flex items-center justify-between gap-2 px-2">
        <div>
          <p className="text-xs font-semibold text-foreground">成片镜头顺序</p>
          <p className="mt-1 text-[10px] text-muted-foreground">时间线片段导航</p>
        </div>
        <StatusBadge>{formatTime(totalSeconds)}</StatusBadge>
      </div>
      <div className="mt-4 flex flex-col gap-1">
        {shots.map((shot) => (
          <button
            type="button"
            key={shot.id}
            onClick={() => onSelect(shot.id)}
            aria-current={activeShotId === shot.id ? "true" : undefined}
            className={
              activeShotId === shot.id
                ? "flex items-center gap-2 rounded-lg border border-foreground bg-muted px-2 py-2 text-left"
                : "flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left hover:bg-muted"
            }
          >
            <span className="w-4 text-[10px] text-muted-foreground">{String(shot.index).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{shot.title}</span>
            <span className="text-[10px] text-muted-foreground">{shot.duration}</span>
          </button>
        ))}
        {shots.length === 0 && <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">还没有可以编排的镜头。</p>}
      </div>
    </aside>
  );
}

function CutWorkspace({
  project,
  shots,
  activeShotId,
  onSelectShot,
}: {
  project: Project | undefined;
  shots: Shot[];
  activeShotId: string;
  onSelectShot: (shotId: string) => void;
}) {
  if (!project) return null;
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[232px_minmax(0,1fr)]">
      <CutSidebar shots={shots} activeShotId={activeShotId} onSelect={onSelectShot} />
      <CutPanel project={project} shots={shots} activeShotId={activeShotId} onSelectShot={onSelectShot} />
    </div>
  );
}

function CutPanel({
  project,
  shots,
  activeShotId,
  onSelectShot,
}: {
  project: Project | undefined;
  shots: Shot[];
  activeShotId: string;
  onSelectShot: (shotId: string) => void;
}) {
  const { addDemoTask } = useStudio();
  const shotKey = shots.map((shot) => shot.id).join("|");
  const [clips, setClips] = useState<TimelineClip[]>(() =>
    shots.map((shot) => ({ id: shot.id, duration: parseDuration(shot.duration) })),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [volumeOn, setVolumeOn] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [resolution, setResolution] = useState("1920 × 1080");
  const [format, setFormat] = useState("MP4");
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setClips((current) => {
      const existing = new Set(current.map((clip) => clip.id));
      const next = [
        ...current.filter((clip) => shots.some((shot) => shot.id === clip.id)),
        ...shots
          .filter((shot) => !existing.has(shot.id))
          .map((shot) => ({ id: shot.id, duration: parseDuration(shot.duration) })),
      ];
      return next.length === current.length && next.every((clip, index) => clip.id === current[index]?.id)
        ? current
        : next;
    });
    if (!shots.some((shot) => shot.id === activeShotId)) onSelectShot(shots[0]?.id ?? "");
  }, [activeShotId, onSelectShot, shotKey, shots]);

  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const activeShot = shots.find((shot) => shot.id === activeShotId) ?? shots[0];
  const activeMedia = getShotMedia(activeShot, project?.cover ?? "");

  useEffect(() => {
    if (!playing || totalDuration <= 0) return;
    const timer = window.setInterval(() => {
      setPlaybackTime((value) => {
        if (value >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return Math.min(totalDuration, value + 0.25);
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, totalDuration]);

  function selectTimelineShot(shotId: string) {
    onSelectShot(shotId);
    setPlaybackTime(0);
  }

  function reorderClip(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setClips((current) => {
      const sourceIndex = current.findIndex((clip) => clip.id === sourceId);
      const targetIndex = current.findIndex((clip) => clip.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function changeDuration(id: string, value: string) {
    const nextDuration = Math.min(60, Math.max(1, Number(value) || 1));
    setClips((current) => current.map((clip) => clip.id === id ? { ...clip, duration: nextDuration } : clip));
  }

  function deleteClip(id: string) {
    setClips((current) => current.filter((clip) => clip.id !== id));
    if (id === activeShotId) {
      const nextShot = clips.find((clip) => clip.id !== id);
      onSelectShot(nextShot?.id ?? "");
    }
  }

  function toggleFullscreen() {
    const element = previewRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void element.requestFullscreen?.();
    }
  }

  function createExportTask() {
    if (!project) return;
    const taskId = addDemoTask({
      type: "export",
      title: `${project.title} · 演示导出`,
      status: "queued",
      stage: "等待导出",
      expectedCredits: 0,
      actualCredits: null,
      input: `${resolution} / ${format} / ${formatTime(totalDuration)}`,
      projectId: project.id,
      resultAssetIds: [],
      retryCount: 0,
      settings: { modelId: "motion-03", ratio: "16:9", quality: "高清", duration: formatTime(totalDuration) },
    });
    if (taskId) setExportNotice(`已创建演示导出任务 · ${resolution} · ${format} · ${formatTime(totalDuration)}。`);
    setExportOpen(false);
  }

  // 所有 hook 已执行完毕；项目缺失时不再渲染，避免读 undefined 的属性。
  if (!project) return null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="成片"
        description="把镜头整理成基础时间线，预览和导出设置保持在同一工作区。"
        actions={
          <ControlButton variant="primary" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="size-3.5" />
            导出演示
          </ControlButton>
        }
      />
      {exportNotice && (
        <Notice tone="accent">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          {exportNotice}
        </Notice>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="studio-surface min-w-0 p-3 sm:p-4">
          <div ref={previewRef} className="relative aspect-video overflow-hidden bg-studio-ink">
            <MediaThumb
              src={activeMedia}
              alt={activeShot ? `${activeShot.title}预览` : `${project.title}封面预览`}
              fallback={activeShot?.title ?? project.title}
              className="absolute inset-0 size-full"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-studio-ink/80 via-transparent to-studio-ink/25" />
            <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
              <span className="rounded bg-studio-ink/75 px-2 py-1 text-[11px] text-studio-ink-foreground">{activeShot ? `镜头 ${String(activeShot.index).padStart(2, "0")}` : "项目封面"}</span>
              <span className="rounded bg-studio-ink/60 px-2 py-1 text-[11px] text-studio-ink-muted">演示预览</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 p-3 text-studio-ink-foreground sm:p-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">{activeShot?.title ?? project.title}</span>
                <span className="shrink-0 text-studio-ink-muted">{formatTime(playbackTime)} / {formatTime(totalDuration)}</span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-studio-ink-line">
                <div className="h-full rounded-full bg-studio-ink-foreground transition-[width]" style={{ width: `${totalDuration ? Math.min(100, (playbackTime / totalDuration) * 100) : 0}%` }} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-x border-b border-border bg-muted/30 px-3 py-2">
            <button type="button" aria-label={playing ? "暂停预览" : "播放预览"} onClick={() => setPlaying((value) => !value)} className="inline-flex size-8 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90">
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">{formatTime(playbackTime)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, totalDuration)}
              step="0.25"
              value={Math.min(playbackTime, totalDuration)}
              onChange={(event) => setPlaybackTime(Number(event.target.value))}
              aria-label="预览播放进度"
              className="min-w-28 flex-1 accent-foreground"
            />
            <span className="text-xs tabular-nums text-muted-foreground">{formatTime(totalDuration)}</span>
            <button type="button" aria-label={volumeOn ? "关闭音量" : "打开音量"} onClick={() => setVolumeOn((value) => !value)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              {volumeOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </button>
            <button type="button" aria-label="全屏预览" onClick={toggleFullscreen} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              <Maximize2 className="size-3.5" />
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">镜头时间线</p>
                <p className="mt-1 text-[11px] text-muted-foreground">拖动缩略图调整顺序；时长和删除只影响当前本地演示状态。</p>
              </div>
              <div className="text-right text-[11px] text-muted-foreground">播放头 {formatTime(playbackTime)} · 共 {formatTime(totalDuration)}</div>
            </div>
            <div className="studio-scroll-x mt-3 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
                {clips.map((clip, index) => {
                  const shot = shots.find((item) => item.id === clip.id);
                  const selected = clip.id === activeShotId;
                  return (
                    <div
                      key={clip.id}
                      draggable
                      onDragStart={(event: DragEvent<HTMLDivElement>) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingId(clip.id);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggingId) reorderClip(draggingId, clip.id);
                        setDraggingId(null);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      className={selected ? "relative w-36 shrink-0 cursor-grab overflow-hidden border border-foreground bg-muted ring-1 ring-foreground active:cursor-grabbing" : "relative w-36 shrink-0 cursor-grab overflow-hidden border border-border bg-background active:cursor-grabbing"}
                    >
                      <button type="button" onClick={() => selectTimelineShot(clip.id)} className="block w-full text-left">
                        <MediaThumb src={getShotMedia(shot, project.cover)} alt={shot?.title ?? `镜头 ${index + 1}`} fallback={shot?.title ?? "镜头"} className="aspect-video" />
                        <div className="flex items-center gap-1.5 px-2 py-2">
                          <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{String(index + 1).padStart(2, "0")} · {shot?.title ?? "未命名镜头"}</span>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {clips.length === 0 && <div className="flex min-h-28 min-w-full items-center justify-center border border-dashed border-border text-xs text-muted-foreground">时间线为空，请从分镜添加镜头。</div>}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {clips.map((clip, index) => {
                const shot = shots.find((item) => item.id === clip.id);
                return (
                  <div key={clip.id} className="flex items-center gap-2 border-t border-border/70 py-2.5">
                    <span className="w-5 text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{shot?.title ?? "未命名镜头"}</span>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>时长</span>
                      <input type="number" min="1" max="60" value={clip.duration} onChange={(event) => changeDuration(clip.id, event.target.value)} aria-label={`${shot?.title ?? "镜头"}时长（秒）`} className="studio-field h-7 w-16 border border-border bg-background px-2 text-right text-xs text-foreground outline-none focus:border-studio-accent/60" />
                      <span>秒</span>
                    </label>
                    <IconAction label={`删除${shot?.title ?? "镜头"}`} onClick={() => deleteClip(clip.id)}>
                      <Trash2 />
                    </IconAction>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="studio-surface h-fit p-4 lg:sticky lg:top-20">
          <SectionHeading title="输出设置" description="导出演示任务摘要" />
          <div className="mt-4 flex flex-col gap-3">
            <SelectField
              label="分辨率"
              value={resolution}
              onChange={setResolution}
              options={[
                { value: "1920 × 1080", label: "1920 × 1080" },
                { value: "1080 × 1920", label: "1080 × 1920" },
                { value: "1080 × 1080", label: "1080 × 1080" },
              ]}
            />
            <SelectField
              label="格式"
              value={format}
              onChange={setFormat}
              options={[
                { value: "MP4", label: "MP4" },
                { value: "MOV", label: "MOV" },
              ]}
            />
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">总时长</span><span className="font-medium text-foreground">{formatTime(totalDuration)}</span></div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">镜头数量</span><span className="font-medium text-foreground">{clips.length}</span></div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">预计消耗</span><span className="font-medium text-foreground">0 积分</span></div>
            </div>
            <Notice tone="warning">
              <Clock3 className="mt-0.5 size-3.5 shrink-0" />
              演示导出只创建本地模拟任务，不会渲染或下载真实 MP4 文件。
            </Notice>
          </div>
          <ControlButton variant="primary" className="mt-4 w-full" onClick={() => setExportOpen(true)}>
            <Download className="size-3.5" />
            创建导出任务
          </ControlButton>
        </aside>
      </div>
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="创建演示导出"
        description="确认后会在任务中心创建一条本地模拟任务。"
        footer={
          <>
            <ControlButton variant="ghost" onClick={() => setExportOpen(false)}>取消</ControlButton>
            <ControlButton variant="primary" onClick={createExportTask}><Download className="size-3.5" />确认创建任务</ControlButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 border-y border-border py-3 text-xs">
            <div><p className="text-muted-foreground">分辨率</p><p className="mt-1 font-medium text-foreground">{resolution}</p></div>
            <div><p className="text-muted-foreground">格式</p><p className="mt-1 font-medium text-foreground">{format}</p></div>
            <div><p className="text-muted-foreground">总时长</p><p className="mt-1 font-medium text-foreground">{formatTime(totalDuration)}</p></div>
          </div>
          <Notice tone="warning">
            <Clock3 className="mt-0.5 size-3.5 shrink-0" />
            这是演示流程，不会生成可下载的视频文件。
          </Notice>
        </div>
      </Modal>
    </div>
  );
}

