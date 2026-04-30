import type { Metadata } from "next";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = {
    title: "Crypto Wallet S",
    description: "Clean vault wallet for register, login, deposit, and withdrawal flows.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>
                <NextTopLoader
                    color="#3569d4"
                    initialPosition={0.08}
                    crawlSpeed={220}
                    height={3}
                    crawl={true}
                    showSpinner={false}
                    easing="ease"
                    speed={240}
                    shadow="0 0 8px #3569d4,0 0 4px #3569d4"
                />
                <AppProviders>{children}</AppProviders>
            </body>
        </html>
    );
}
