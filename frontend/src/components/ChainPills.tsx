import { useMemo } from "react";
import { Chain } from "../types/api";
import { Badge } from "./Badge";
import { PillButton } from "./PillButton";

interface ChainPillsProps {
  chains: Chain[];
  selected: number[];
  onToggle: (chainId: number) => void;
}

export function ChainPills({ chains, selected, onToggle }: ChainPillsProps) {
  const orderedChains = useMemo(
    () =>
      [...chains].sort((a, b) => {
        if (a.supported === b.supported) {
          return a.name.localeCompare(b.name);
        }

        return a.supported ? -1 : 1;
      }),
    [chains],
  );

  return (
    <div className="flex flex-wrap gap-2">
      {orderedChains.map((chain) => {
        const isSelected = selected.includes(chain.id);
        const isDisabled = !chain.supported;
        const baseLabel = chain.shortName?.trim() ? chain.shortName : chain.name;
        const label = chain.supported ? baseLabel : `${chain.name} (${chain.id})`;

        return (
          <div key={chain.id} className="flex items-center gap-2">
            <PillButton
              active={isSelected}
              disabled={isDisabled}
              onClick={() => onToggle(chain.id)}
            >
              {label}
            </PillButton>
            {!chain.supported ? <Badge variant="warning">Unsupported</Badge> : null}
          </div>
        );
      })}
    </div>
  );
}
