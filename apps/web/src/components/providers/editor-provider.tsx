"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useKeybindingsListener } from "@/actions/use-keybindings";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useEditorActions } from "@/actions/use-editor-actions";
import { CollabProvider } from "@/collab/collab-context";
import { useCollabToken, userColor } from "@/collab/use-collab-token";
import { loadFontAtlas } from "@/fonts/google-fonts";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";

interface EditorProviderProps {
	projectId: string;
	children: React.ReactNode;
}

export function EditorProvider({ projectId, children }: EditorProviderProps) {
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { setLoadingProject } = useKeybindingsStore();

	useEffect(() => {
		setLoadingProject(isLoading);
	}, [isLoading, setLoadingProject]);

	useEffect(() => {
		let cancelled = false;
		const editor = EditorCore.getInstance();

		const loadProject = async () => {
			try {
				setIsLoading(true);
				await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());
				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;

				const isNotFound =
					err instanceof Error &&
					(err.message.includes("not found") ||
						err.message.includes("does not exist"));

				if (isNotFound) {
					try {
						// Honour the URL's id so collab peers end up in the same
						// Hocuspocus room (project:<id>). When this client is the
						// first writer, the placeholder is what gets uploaded; when
						// it joins a room that already has a snapshot, the
						// CollaborationManager observer overwrites the placeholder
						// from the Y.Doc as soon as the WebSocket syncs.
						await editor.project.createNewProject({
							name: "Untitled Project",
							id: projectId,
						});
						if (cancelled) return;
						setIsLoading(false);
						loadFontAtlas();
					} catch (_createErr) {
						setError("Failed to create project");
						setIsLoading(false);
					}
				} else {
					const wasmPanic = (window as Window & { __wasmPanic?: string })
						.__wasmPanic;
					if (wasmPanic) {
						delete (window as Window & { __wasmPanic?: string }).__wasmPanic;
						setError(wasmPanic);
					} else {
						setError(
							err instanceof Error ? err.message : "Failed to load project",
						);
					}
					setIsLoading(false);
				}
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, router]);

	if (error) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<p className="text-destructive text-sm">{error}</p>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Loading project...</p>
				</div>
			</div>
		);
	}

	if (!activeProject) {
		return <ExitingProjectScreen />;
	}

	return (
		<>
			<EditorRuntimeBindings />
			<CollabSessionGate projectId={projectId}>{children}</CollabSessionGate>
		</>
	);
}

function ExitingProjectScreen() {
	const router = useRouter();
	const [stuck, setStuck] = useState(false);

	useEffect(() => {
		const forceNav = setTimeout(() => {
			router.replace("/projects");
		}, 3000);
		const showRecovery = setTimeout(() => setStuck(true), 6000);
		return () => {
			clearTimeout(forceNav);
			clearTimeout(showRecovery);
		};
	}, [router]);

	return (
		<div className="bg-background flex h-screen w-screen items-center justify-center">
			<div className="flex flex-col items-center gap-4">
				<Loader2 className="text-muted-foreground size-8 animate-spin" />
				<p className="text-muted-foreground text-sm">Exiting project...</p>
				{stuck && (
					<button
						type="button"
						onClick={() => window.location.assign("/projects")}
						className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
					>
						Taking too long? Click to reload
					</button>
				)}
			</div>
		</div>
	);
}

function CollabSessionGate({
	projectId,
	children,
}: {
	projectId: string;
	children: React.ReactNode;
}) {
	const token = useCollabToken(projectId);
	const user = token
		? { id: token.user.id, name: token.user.name, color: userColor(token.user.id) }
		: { id: "anon-local", name: "Local user", color: "#888" };

	return (
		<CollabProvider
			user={user}
			wsUrl={token?.wsUrl || undefined}
			token={token?.token || undefined}
		>
			{children}
		</CollabProvider>
	);
}

function EditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
	}, [editor, rippleEditingEnabled]);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!editor.save.getIsDirty()) return;
			event.preventDefault();
			(event as unknown as { returnValue: string }).returnValue = "";
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [editor]);

	useEditorActions();
	useKeybindingsListener();
	return null;
}
