function emitCopyToast(message: string) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent("app:toast", {
            detail: { message }
        })
    );
}

export async function copyText(value: string): Promise<boolean> {
    const text = String(value || "");
    if (!text) return false;

    if (typeof window === "undefined" || typeof document === "undefined") {
        return false;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            emitCopyToast("Copied");
            return true;
        }
    } catch (_err) {
        // fallback below
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.transform = "translateX(-9999px)";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        textarea.style.fontSize = "16px";

        document.body.appendChild(textarea);
        textarea.focus({ preventScroll: true });
        textarea.select();
        textarea.setSelectionRange(0, text.length);

        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
            emitCopyToast("Copied");
            return true;
        }
    } catch (_err) {
        // fallback below
    }

    try {
        const selection = window.getSelection();
        const span = document.createElement("span");
        span.textContent = text;
        span.style.whiteSpace = "pre";
        span.style.position = "fixed";
        span.style.top = "0";
        span.style.left = "0";
        span.style.transform = "translateX(-9999px)";
        document.body.appendChild(span);

        const range = document.createRange();
        range.selectNodeContents(span);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const ok = document.execCommand("copy");
        selection?.removeAllRanges();
        document.body.removeChild(span);
        if (ok) {
            emitCopyToast("Copied");
            return true;
        }
    } catch (_err) {
        // fallback below
    }

    window.prompt("Copy text:", text);
    return false;
}
