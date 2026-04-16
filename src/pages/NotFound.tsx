import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404: niet-bestaande route bezocht:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <h1 className="mb-3 text-6xl font-bold text-primary">404</h1>
        <p className="mb-2 text-lg font-semibold">Pagina niet gevonden</p>
        <p className="mb-6 text-sm text-muted-foreground">
          De pagina die je zoekt bestaat niet of is verplaatst.
        </p>
        <Link to="/">
          <Button variant="gradient">
            <Home className="w-4 h-4 mr-2" /> Terug naar overzicht
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
