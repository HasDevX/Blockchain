import { Chain } from "../types/api";
import { Badge } from "./Badge";
import { PillButton } from "./PillButton";

interface ChainPillsProps {
  chains: Chain[];
  selected: number[];
  onToggle: (chainId: number) => void;
}

export function ChainPills({ chains, selected, onToggle }: ChainPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {chains.map((chain) => {
        const isSelected = selected.includes(chain.id);
        const isDisabled = !chain.supported;
        const label = chain.shortName || chain.name || `Chain ${chain.id}`;

        return (
          <div key={chain.id} className="flex items-center gap-2">
            <PillButton
              active={isSelected}
              disabled={isDisabled}
              onClick={() => onToggle(chain.id)}
            >
              <span className="flex items-center gap-1">
                <span>{label}</span>
                <span className="text-xs text-slate-400">({chain.id})</span>
              </span>
            </PillButton>
            {!chain.supported ? <Badge variant="warning">Unsupported</Badge> : null}
          </div>
        );
      })}
    </div>
  );
}
