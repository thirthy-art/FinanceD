export interface HierarchicalAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  parentId: number | null;
  isPosting: boolean;
  isActive: boolean;
}

export interface AccountWithDepth extends HierarchicalAccount {
  depth: number;
}

export function flattenAccountHierarchy(accounts: HierarchicalAccount[]): AccountWithDepth[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const children = new Map<number, HierarchicalAccount[]>();
  const roots: HierarchicalAccount[] = [];
  const sortByCode = (left: HierarchicalAccount, right: HierarchicalAccount) => left.code.localeCompare(right.code);

  for (const account of accounts) {
    if (account.parentId && account.parentId !== account.id && byId.has(account.parentId)) {
      const siblings = children.get(account.parentId) ?? [];
      siblings.push(account);
      children.set(account.parentId, siblings);
    } else {
      roots.push(account);
    }
  }

  const result: AccountWithDepth[] = [];
  const visited = new Set<number>();
  const append = (account: HierarchicalAccount, depth: number) => {
    if (visited.has(account.id)) return;
    visited.add(account.id);
    result.push({ ...account, depth });
    for (const child of (children.get(account.id) ?? []).sort(sortByCode)) append(child, depth + 1);
  };

  for (const root of roots.sort(sortByCode)) append(root, 0);
  for (const account of [...accounts].sort(sortByCode)) append(account, 0);
  return result;
}

export function selectableExpenseAccounts(accounts: HierarchicalAccount[]): AccountWithDepth[] {
  return flattenAccountHierarchy(accounts).filter(
    (account) => account.type === "expense" && account.isActive && account.isPosting,
  );
}
