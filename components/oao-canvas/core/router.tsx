import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/oao-canvas/core/components/layout/analytics-tracker";
import UserLayout from "@/components/oao-canvas/core/layouts/user-layout";
import AssetsPage from "@/components/oao-canvas/core/pages/assets";
import CanvasPage from "@/components/oao-canvas/core/pages/canvas";
import CanvasProjectPage from "@/components/oao-canvas/core/pages/canvas/project";
import ConfigPage from "@/components/oao-canvas/core/pages/config";
import HomePage from "@/components/oao-canvas/core/pages/home";
import ImagePage from "@/components/oao-canvas/core/pages/image";
import NotFound from "@/components/oao-canvas/core/pages/not-found";
import VideoPage from "@/components/oao-canvas/core/pages/video";

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
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
