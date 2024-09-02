import {
  IProjectMetadataLookup,
  JavaProjectMetadataLookup,
  JavaScriptProjectMetadataLookup,
  GoProjectMetadataLookup,
  PythonProjectMetadataLookup,
  PhpProjectMetadataLookup,
  CSharpProjectMetadataLookup,
  DartProjectMetadataLookup,
  RubyProjectMetadataLookup,
  RustProjectMetadataLookup,
  CProjectMetadataLookup,
  CompositeProjectMetadataLookup,
  ProjectMetadata,
  Dependency,
} from './ProjectMetadataLookups.ts';

function determineProgrammingLanguage(skill: ProjectMetadata): string {
  return skill.language.version ? `${skill.language.name} ${skill.language.version}` : skill.language.name;
}

function getMetadataLookup(languageId: string): DistinctProjectMetadataLookup {
  const delegate =
    lookups.find((lookup) =>
      typeof lookup.languageId === 'string'
        ? lookup.languageId === languageId
        : Array.isArray(lookup.languageId)
          ? lookup.languageId.includes(languageId)
          : false
    ) || new CompositeProjectMetadataLookup(languageId, lookups);
  return new DistinctProjectMetadataLookup(delegate);
}

const lookups: IProjectMetadataLookup[] = [
  new JavaProjectMetadataLookup(),
  new JavaScriptProjectMetadataLookup(),
  new GoProjectMetadataLookup(),
  new PythonProjectMetadataLookup(),
  new PhpProjectMetadataLookup(),
  new CSharpProjectMetadataLookup(),
  new DartProjectMetadataLookup(),
  new RubyProjectMetadataLookup(),
  new RustProjectMetadataLookup(),
  new CProjectMetadataLookup(),
];

class DistinctProjectMetadataLookup implements IProjectMetadataLookup {
  private delegate: IProjectMetadataLookup;
  public languageId: string | string[];

  constructor(delegate: IProjectMetadataLookup) {
    this.delegate = delegate;
    this.languageId = delegate.languageId;
  }

  determineBuildTools(skill: ProjectMetadata): Dependency[] {
    return this.deduplicateDependencies(this.delegate.determineBuildTools(skill));
  }

  determineApplicationFrameworks(skill: ProjectMetadata): Dependency[] {
    return this.deduplicateDependencies(this.delegate.determineApplicationFrameworks(skill));
  }

  determineCoreLibraries(skill: ProjectMetadata): Dependency[] {
    return this.deduplicateDependencies(this.delegate.determineCoreLibraries(skill));
  }

  determineTestingFrameworks(skill: ProjectMetadata): Dependency[] {
    return this.deduplicateDependencies(this.delegate.determineTestingFrameworks(skill));
  }

  determineTestingLibraries(skill: ProjectMetadata): Dependency[] {
    return this.deduplicateDependencies(this.delegate.determineTestingLibraries(skill));
  }

  private deduplicateDependencies(dependencies: Dependency[]): Dependency[] {
    const deduplicated: Dependency[] = [];
    dependencies.forEach((dep) => {
      if (!deduplicated.some((d) => d === dep)) {
        deduplicated.push(dep);
      }
    });
    return deduplicated;
  }
}

export { determineProgrammingLanguage, getMetadataLookup, DistinctProjectMetadataLookup };
