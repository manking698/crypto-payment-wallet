"use client";

type ProcessingLayerProps = {
    open: boolean;
    text?: string;
    zIndexClassName?: string;
};

export function ProcessingLayer(props: ProcessingLayerProps) {
    if (!props.open) return null;

    return (
        <div className={`fixed inset-0 ${props.zIndexClassName || "z-[80]"} bg-black/18`}>
            <div className="flex min-h-screen items-center justify-center">
                <div className="flex h-[8.6rem] w-[8.6rem] flex-col items-center justify-center rounded-xl bg-[#5f666d]/92 text-white shadow-[0_10px_30px_rgba(15,23,42,0.28)]">
                    <span className="inline-flex h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
                    <p className="mt-3 text-[1.02rem] font-medium tracking-[0.01em]">{props.text || "processing..."}</p>
                </div>
            </div>
        </div>
    );
}

