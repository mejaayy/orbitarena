import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Lobby from "@/pages/Lobby";
import Game from "@/pages/Game";
import Terms from "@/pages/Terms";
import Profile from "@/pages/Profile";
import KeyConverter from "@/pages/KeyConverter";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Lobby} />
      <Route path="/game" component={Game} />
      <Route path="/terms" component={Terms} />
      <Route path="/profile" component={Profile} />
      <Route path="/key-convert" component={KeyConverter} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Router />
    </QueryClientProvider>
  );
}

export default App;
