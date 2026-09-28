import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/oao-canvas/reference-src/components/layout/analytics-tracker";
import UserLayout from "@/components/oao-canvas/reference-src/layouts/user-layout";
import AssetsPage from "@/components/oao-canvas/reference-src/pages/assets";
import CanvasPage from "@/components/oao-canvas/reference-src/pages/canvas";
import CanvasProjectPage from "@/components/oao-canvas/reference-src/pages/canvas/project";
import ConfigPage from "@/components/oao-canvas/reference-src/pages/config";
import HomePage from "@/components/oao-canvas/reference-src/pages/home";
import ImagePage from "@/components/oao-canvas/reference-src/pages/image";
import NotFound from "@/components/oao-canvas/reference-src/pages/not-found";
import PromptsPage from "@/components/oao-canvas/reference-src/pages/prompts";
import VideoPage from "@/components/oao-canvas/reference-src/pages/video";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
