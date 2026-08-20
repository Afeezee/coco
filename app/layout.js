import "./globals.css";

export const metadata = {
  title: "CoCo: Corrosion Console",
  description: "Explainable ML console for CO2 (sweet) internal pipeline corrosion",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
