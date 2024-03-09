export interface PackageInterface {
  name: string;
  lastActive: number;
}

export interface PackageStatus {
  userid: number;
  username: string | undefined;
  packages: PackageInterface[];
}

export interface PackageMark {
  name: string;
  marks: {
    name: string;
    by: {
      url: string;
      uid: number;
      alias: string;
    } | null;
    comment: string;
  }[];
}

export interface Trigger {
  name: string;
  op: "mark" | "unmark";
  when: "mark" | "unmark";
}

export interface MarkConfig {
  desc: string;
  helpMsg: string;
  requireComment: boolean;
  allowUserModification: { mark: boolean; unmark: boolean };
  appendTimeComment: boolean;
  triggers: Trigger[];
}

export interface OldPackageStatus {
  userid: number;
  username?: string | undefined;
  packages: (string | PackageInterface)[];
}

export interface MarkRecord {
  name: string;
  by: {
    url: string;
    uid: number;
    alias: string;
  } | null;
  comment: string;
}

export interface OldPackageMark {
  name: string;
  marks: string[] | (Omit<MarkRecord, "comment"> & Pick<Partial<MarkRecord>, "comment">)[];
}

export interface GetMessageLinkOptions {
  chatUserName?: string;
  chatId?: string | number;
  msgId: string | number;
}

// for frontend

export interface StrippedPackageStatus {
  alias: string;
  packages: string[];
}

export interface StrippedPackageMark {
  name: string;
  marks: {
    name: string;
    by: {
      alias: string;
    };
    comment: string;
  }[];
}
