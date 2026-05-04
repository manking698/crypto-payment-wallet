"use client";

type ProcessingLayerProps = {
    open: boolean;
    text?: string;
    zIndexClassName?: string;
};

export function ProcessingLayer(props: ProcessingLayerProps) {
    if (!props.open) return null;
    const rawText = String(props.text || "").trim().toLowerCase();
    const label = !rawText || rawText.includes("processing") ? "Please wait..." : String(props.text);

    return (
        <div className={`fixed inset-0 ${props.zIndexClassName || "z-[80]"} bg-slate-900/32`}>
            <div className="flex min-h-screen -translate-y-[5vh] items-center justify-center px-6">
                <div className="flex h-[5.3rem] w-full max-w-[11.4rem] items-center justify-center rounded-[0.85rem] border border-slate-200 bg-white px-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
                    <span className="inline-flex h-7 w-7 animate-spin rounded-full border-[4px] border-slate-300 border-t-slate-600" />
                    <p className="ml-3.5 text-[0.82rem] font-semibold text-slate-900">
                        {label}
                    </p>
                </div>
            </div>
        </div>
    );
}
