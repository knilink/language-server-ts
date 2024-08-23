interface IHeaderContributor {
  contributeHeaderValues(url: string, headers: Record<string, string>): void;
}

class HeaderContributors {
  private contributors: IHeaderContributor[] = [];

  add(contributor: IHeaderContributor): void {
    this.contributors.push(contributor);
  }

  remove(contributor: IHeaderContributor): void {
    const index = this.contributors.indexOf(contributor);
    if (index !== -1) {
      this.contributors.splice(index, 1);
    }
  }

  contributeHeaders(url: string, headers: Record<string, string>): void {
    for (const contributor of this.contributors) {
      contributor.contributeHeaderValues(url, headers);
    }
  }

  size(): number {
    return this.contributors.length;
  }
}

export { IHeaderContributor, HeaderContributors };
