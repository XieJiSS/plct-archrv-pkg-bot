use sqlx::FromRow;

/// Describe the `packager` table
#[derive(FromRow, Debug)]
pub struct Packager {
    /// Unique uid from telegram
    pub tg_uid: i64,
    /// A alias name for the packager
    pub alias: String,
}

/// Describe the `package` table
#[derive(FromRow, Debug)]
pub struct Package {
    /// A unique id for this package
    pub id: i64,
    /// Name of the package
    pub name: String,
}

/// Describe the `assignment` table
#[derive(FromRow, Debug)]
pub struct Assignment {
    /// Unique ID for one assignment
    pub id: i64,
    /// ID point to the [`Package`] being assigned
    pub pkg: i64,
    /// [`Packager`] assign to the package. Reference to [`Packager`] id property.
    pub assignee: i64,
    /// Unix epoch timestamp
    pub assigned_at: i64,
}

/// Describe the `mark` table
#[derive(FromRow, Debug)]
pub struct Mark {
    /// Unique ID for one mark record
    pub id: i64,
    /// Kind of the status
    pub kind: String,
    /// Optional comment attach to a mark record
    pub comment: Option<String>,
    /// Describe which tg message create this mark
    pub msg_id: i64,

    /// Optional. Describe which [`Packager`] create this mark. Reference to [`Packager`] id
    /// property.
    pub marked_by: Option<i64>,
    /// Describe when does this mark record create, unix epoch timestamp
    pub marked_at: i64,
    /// Describe which [`Package`] this mark record for
    pub marked_for: i64,
}

macro_rules! new_pkg_relation {
    ($($name:ident,)+) => {
        $(
            /// Describe a unsatisfied dependency relationship
            #[derive(FromRow, Debug)]
            pub struct $name {
                /// The source package which fail to be built, reference to [`Package`] id property
                pub source: i64,
                /// The target package causing build failure, reference to [`Package`] id property
                pub target: i64,
                /// The mark that create this relationship, reference to [`Mark`] id property
                pub mark_id: i64,
            }
        )+
    };
}

new_pkg_relation! {
    OutdatedDeps,
    MissingDeps,
}
