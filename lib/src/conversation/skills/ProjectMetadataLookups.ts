import type { ProjectMetadata, Dependency } from './ProjectMetadataSkill.ts';

function addFromLibraries(
  skill: ProjectMetadata,
  dependencies: Dependency[],
  searchPattern: string,
  commonName: string
) {
  const dependency = skill.libraries.find((lib) => lib.name.toLowerCase().includes(searchPattern.toLowerCase()));
  if (dependency) {
    dependencies.push({ name: commonName, version: dependency.version });
  }
}

interface IProjectMetadataLookup {
  readonly languageId: string[] | string;
  determineBuildTools(skill: ProjectMetadata): Dependency[];
  determineApplicationFrameworks(skill: ProjectMetadata): Dependency[];
  determineTestingFrameworks(skill: ProjectMetadata): Dependency[];
  determineCoreLibraries(skill: ProjectMetadata): Dependency[];
  determineTestingLibraries(skill: ProjectMetadata): Dependency[];
}

class JavaProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = ['java', 'kotlin', 'scala', 'groovy'];
  determineBuildTools(skill: ProjectMetadata) {
    return [...skill.buildTools];
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'org.springframework.boot', 'Spring Boot');
    addFromLibraries(skill, frameworks, 'jakarta.jakartaee-api', 'Jakarta EE');
    addFromLibraries(skill, frameworks, 'javax:javaee-api', 'Java EE');
    addFromLibraries(skill, frameworks, 'org.apache.struts:struts2-core', 'Apache Struts');
    addFromLibraries(skill, frameworks, 'org.hibernate:hibernate-core', 'Hibernate');
    addFromLibraries(skill, frameworks, 'org.apache.wicket:wicket-core', 'Apache Wicket');
    addFromLibraries(skill, frameworks, 'javax.faces:jsf-api', 'JSF');
    addFromLibraries(skill, frameworks, 'org.grails:grails-core', 'Grails');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'com.google.guava', 'Google Guava');
    addFromLibraries(skill, libraries, 'org.apache.commons:commons-lang3', 'Apache Commons Lang');
    addFromLibraries(skill, libraries, 'org.apache.commons:commons-io', 'Apache Commons IO');
    addFromLibraries(skill, libraries, 'joda-time:joda-time', 'Joda-Time');
    addFromLibraries(skill, libraries, 'com.google.code.gson:gson', 'Google Gson');
    addFromLibraries(skill, libraries, 'org.apache.commons:commons-math3', 'Apache Commons Math');
    addFromLibraries(skill, libraries, 'org.apache.commons:commons-collections4', 'Apache Commons Collections');
    addFromLibraries(skill, libraries, 'org.apache.commons:commons-net', 'Apache Commons Net');
    addFromLibraries(skill, libraries, 'org.apache.poi:poi', 'Apache POI');
    addFromLibraries(skill, libraries, 'com.fasterxml.jackson.core:jackson-databind', 'Jackson');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'org.junit.jupiter:junit-jupiter', 'JUnit');
    addFromLibraries(skill, frameworks, 'junit:junit', 'JUnit');
    addFromLibraries(skill, frameworks, 'org.testng:testng', 'TestNG');
    addFromLibraries(skill, frameworks, 'org.spockframework:spock-core', 'Spock');
    addFromLibraries(skill, frameworks, 'io.cucumber:cucumber-java', 'Cucumber');
    addFromLibraries(skill, frameworks, 'org.jboss.arquillian.junit:arquillian-junit-container', 'Arquillian');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'org.mockito', 'Mockito');
    addFromLibraries(skill, libraries, 'org.assertj', 'AssertJ');
    addFromLibraries(skill, libraries, 'org.hamcrest', 'Hamcrest');
    addFromLibraries(skill, libraries, 'org.powermock', 'PowerMock');
    addFromLibraries(skill, libraries, 'org.jmock', 'JMock');
    addFromLibraries(skill, libraries, 'org.easymock', 'EasyMock');
    addFromLibraries(skill, libraries, 'org.jmockit:jmockit', 'JMockit');
    addFromLibraries(skill, libraries, 'com.github.tomakehurst:wiremock', 'WireMock');
    addFromLibraries(skill, libraries, 'org.dbunit:dbunit', 'DBUnit');
    addFromLibraries(skill, libraries, 'com.icegreen:greenmail', 'GreenMail');
    addFromLibraries(skill, libraries, 'net.sourceforge.htmlunit:htmlunit', 'HtmlUnit');
    addFromLibraries(skill, libraries, 'org.seleniumhq.selenium:selenium-java', 'Selenium');
    addFromLibraries(skill, libraries, 'io.rest-assured:rest-assured', 'Rest-Assured');
    addFromLibraries(skill, libraries, 'io.gatling.highcharts:gatling-charts-highcharts', 'Gatling');
    addFromLibraries(skill, libraries, 'org.apache.jmeter:ApacheJMeter', 'JMeter');
    return libraries;
  }
}

class JavaScriptProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue'];
  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, '@types/node', 'Node.js');
    addFromLibraries(skill, frameworks, 'react-native', 'React Native');
    frameworks.find((f_n) => f_n.name === 'React Native') || addFromLibraries(skill, frameworks, 'react', 'React');
    addFromLibraries(skill, frameworks, 'angular', 'Angular');
    addFromLibraries(skill, frameworks, 'vue', 'Vue.js');
    addFromLibraries(skill, frameworks, 'ember', 'Ember.js');
    addFromLibraries(skill, frameworks, 'backbone', 'Backbone.js');
    addFromLibraries(skill, frameworks, 'meteor', 'Meteor');
    addFromLibraries(skill, frameworks, 'polymer', 'Polymer');
    addFromLibraries(skill, frameworks, 'aurelia', 'Aurelia');
    addFromLibraries(skill, frameworks, 'knockout', 'Knockout.js');
    addFromLibraries(skill, frameworks, 'dojo', 'Dojo Toolkit');
    addFromLibraries(skill, frameworks, 'mithril', 'Mithril.js');
    addFromLibraries(skill, frameworks, 'marionette', 'Marionette.js');
    addFromLibraries(skill, frameworks, 'marko', 'Marko.js');
    addFromLibraries(skill, frameworks, 'svelte', 'Svelte');
    addFromLibraries(skill, frameworks, 'hyperapp', 'Hyperapp');
    addFromLibraries(skill, frameworks, 'inferno', 'Inferno.js');
    addFromLibraries(skill, frameworks, 'preact', 'Preact');
    addFromLibraries(skill, frameworks, 'riot', 'Riot.js');
    addFromLibraries(skill, frameworks, 'moon', 'Moon.js');
    addFromLibraries(skill, frameworks, 'stencil', 'Stencil.js');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'lodash', 'Lodash');
    addFromLibraries(skill, libraries, 'moment', 'Moment.js');
    addFromLibraries(skill, libraries, 'axios', 'Axios');
    addFromLibraries(skill, libraries, 'redux', 'Redux');
    addFromLibraries(skill, libraries, 'recoil', 'Recoil');
    addFromLibraries(skill, libraries, 'jquery', 'jQuery');
    addFromLibraries(skill, libraries, 'd3', 'D3.js');
    addFromLibraries(skill, libraries, 'underscore', 'Underscore.js');
    addFromLibraries(skill, libraries, 'ramda', 'Ramda');
    addFromLibraries(skill, libraries, 'immutable', 'Immutable.js');
    addFromLibraries(skill, libraries, 'rxjs', 'RxJS');
    addFromLibraries(skill, libraries, 'three', 'Three.js');
    addFromLibraries(skill, libraries, 'socket.io', 'Socket.IO');
    addFromLibraries(skill, libraries, 'express', 'Express.js');
    addFromLibraries(skill, libraries, 'next', 'Next.js');
    addFromLibraries(skill, libraries, 'puppeteer', 'Puppeteer');
    addFromLibraries(skill, libraries, 'cheerio', 'Cheerio');
    addFromLibraries(skill, libraries, 'nodemailer', 'Nodemailer');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'jest', 'Jest');
    addFromLibraries(skill, frameworks, 'mocha', 'Mocha');
    addFromLibraries(skill, frameworks, 'jasmine', 'Jasmine');
    addFromLibraries(skill, frameworks, 'ava', 'AVA');
    addFromLibraries(skill, frameworks, 'qunit', 'QUnit');
    addFromLibraries(skill, frameworks, 'tape', 'Tape');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'chai', 'Chai');
    addFromLibraries(skill, libraries, 'sinon', 'Sinon');
    addFromLibraries(skill, libraries, 'enzyme', 'Enzyme');
    addFromLibraries(skill, libraries, 'protractor', 'Protractor');
    addFromLibraries(skill, libraries, 'supertest', 'Supertest');
    addFromLibraries(skill, libraries, 'nock', 'Nock');
    addFromLibraries(skill, libraries, 'cypress', 'Cypress');
    addFromLibraries(skill, libraries, '@testing-library/react', 'React Testing Library');
    return libraries;
  }
}

class GoProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = 'go';

  determineBuildTools(skill: ProjectMetadata): Dependency[] {
    return skill.buildTools;
  }

  determineApplicationFrameworks(skill: ProjectMetadata): Dependency[] {
    const frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'github.com/gorilla/mux', 'Gorilla Mux');
    addFromLibraries(skill, frameworks, 'github.com/onsi/ginkgo', 'ginkgo');
    addFromLibraries(skill, frameworks, 'github.com/onsi/gomega', 'gomega');
    addFromLibraries(skill, frameworks, 'github.com/stretchr/testify', 'testify');
    addFromLibraries(skill, frameworks, 'gopkg.in/check.v1', 'gocheck');
    addFromLibraries(skill, frameworks, 'github.com/franela/goblin', 'goblin');
    addFromLibraries(skill, frameworks, 'github.com/DATA-DOG/godog', 'godog');
    addFromLibraries(skill, frameworks, 'github.com/stesla/gospec', 'gospec');
    addFromLibraries(skill, frameworks, 'github.com/rjeczalik/gotest', 'gotest');
    addFromLibraries(skill, frameworks, 'github.com/smartystreets/goconvey', 'goconvey');
    return frameworks;
  }

  determineCoreLibraries(skill: ProjectMetadata): Dependency[] {
    const libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'time', 'time');
    addFromLibraries(skill, libraries, 'math', 'math');
    addFromLibraries(skill, libraries, 'strconv', 'strconv');
    addFromLibraries(skill, libraries, 'strings', 'strings');
    addFromLibraries(skill, libraries, 'sort', 'sort');
    addFromLibraries(skill, libraries, 'encoding/json', 'encoding/json');
    return libraries;
  }

  determineTestingFrameworks(skill: ProjectMetadata): Dependency[] {
    const frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'github.com/onsi/ginkgo', 'ginkgo');
    addFromLibraries(skill, frameworks, 'github.com/onsi/gomega', 'gomega');
    addFromLibraries(skill, frameworks, 'github.com/stretchr/testify', 'testify');
    addFromLibraries(skill, frameworks, 'gopkg.in/check.v1', 'gocheck');
    addFromLibraries(skill, frameworks, 'github.com/franela/goblin', 'goblin');
    addFromLibraries(skill, frameworks, 'github.com/DATA-DOG/godog', 'godog');
    addFromLibraries(skill, frameworks, 'github.com/stesla/gospec', 'gospec');
    addFromLibraries(skill, frameworks, 'github.com/rjeczalik/gotest', 'gotest');
    addFromLibraries(skill, frameworks, 'github.com/smartystreets/goconvey', 'goconvey');
    return frameworks;
  }

  determineTestingLibraries(skill: ProjectMetadata): Dependency[] {
    const libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'github.com/stretchr/testify', 'Testify');
    addFromLibraries(skill, libraries, 'github.com/smartystreets/goconvey', 'GoConvey');
    addFromLibraries(skill, libraries, 'github.com/onsi/ginkgo', 'Ginkgo');
    addFromLibraries(skill, libraries, 'github.com/golang/mock', 'GoMock');
    addFromLibraries(skill, libraries, 'gopkg.in/check.v1', 'GoCheck');
    addFromLibraries(skill, libraries, 'github.com/franela/goblin', 'Goblin');
    addFromLibraries(skill, libraries, 'github.com/DATA-DOG/godog', 'GoDog');
    addFromLibraries(skill, libraries, 'github.com/onsi/gomega', 'Gomega');
    addFromLibraries(skill, libraries, 'github.com/stesla/gospec', 'GoSpec');
    addFromLibraries(skill, libraries, 'github.com/rjeczalik/gotest', 'GoTest');
    return libraries;
  }
}

class PythonProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = ['python', 'jupyter'];
  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'flask', 'Flask');
    addFromLibraries(skill, frameworks, 'django', 'Django');
    addFromLibraries(skill, frameworks, 'pyramid', 'Pyramid');
    addFromLibraries(skill, frameworks, 'tornado', 'Tornado');
    addFromLibraries(skill, frameworks, 'fastapi', 'FastAPI');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'requests', 'requests');
    addFromLibraries(skill, libraries, 'numpy', 'numpy');
    addFromLibraries(skill, libraries, 'pandas', 'pandas');
    addFromLibraries(skill, libraries, 'scipy', 'scipy');
    addFromLibraries(skill, libraries, 'matplotlib', 'matplotlib');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'pytest', 'Pytest');
    addFromLibraries(skill, frameworks, 'unittest', 'Unittest');
    addFromLibraries(skill, frameworks, 'doctest', 'Doctest');
    addFromLibraries(skill, frameworks, 'nose', 'Nose');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'mock', 'Mock');
    addFromLibraries(skill, libraries, 'hypothesis', 'Hypothesis');
    addFromLibraries(skill, libraries, 'behave', 'Behave');
    addFromLibraries(skill, libraries, 'lettuce', 'Lettuce');
    addFromLibraries(skill, libraries, 'testify', 'Testify');
    addFromLibraries(skill, libraries, 'pyhamcrest', 'PyHamcrest');
    return libraries;
  }
}

class PhpProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = ['php', 'blade'];

  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'laravel/framework', 'Laravel');
    addFromLibraries(skill, frameworks, 'symfony/symfony', 'Symfony');
    addFromLibraries(skill, frameworks, 'slim/slim', 'Slim');
    addFromLibraries(skill, frameworks, 'cakephp/cakephp', 'CakePHP');
    addFromLibraries(skill, frameworks, 'yiisoft/yii2', 'Yii');
    addFromLibraries(skill, frameworks, 'zendframework/zendframework', 'Zend Framework');
    addFromLibraries(skill, frameworks, 'phalcon/cphalcon', 'Phalcon');
    addFromLibraries(skill, frameworks, 'bcosca/fatfree', 'Fat-Free');
    addFromLibraries(skill, frameworks, 'fuel/fuel', 'FuelPHP');
    addFromLibraries(skill, frameworks, 'phpixie/framework', 'PHPixie');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'monolog/monolog', 'Monolog');
    addFromLibraries(skill, libraries, 'vlucas/phpdotenv', 'PHP dotenv');
    addFromLibraries(skill, libraries, 'symfony/console', 'Symfony Console');
    addFromLibraries(skill, libraries, 'guzzlehttp/guzzle', 'GuzzleHttp');
    addFromLibraries(skill, libraries, 'ramsey/uuid', 'Ramsey UUID');
    addFromLibraries(skill, libraries, 'doctrine/orm', 'Doctrine ORM');
    addFromLibraries(skill, libraries, 'php-di/php-di', 'PHP-DI');
    addFromLibraries(skill, libraries, 'phpunit/php-timer', 'PHPUnit Timer');
    addFromLibraries(skill, libraries, 'symfony/finder', 'Symfony Finder');
    addFromLibraries(skill, libraries, 'symfony/yaml', 'Symfony Yaml');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'phpunit/phpunit', 'PHPUnit');
    addFromLibraries(skill, frameworks, 'behat/behat', 'Behat');
    addFromLibraries(skill, frameworks, 'phpspec/phpspec', 'PHPSpec');
    addFromLibraries(skill, frameworks, 'codeception/codeception', 'Codeception');
    addFromLibraries(skill, frameworks, 'atoum/atoum', 'Atoum');
    addFromLibraries(skill, frameworks, 'pestphp/pest', 'PestPHP');
    addFromLibraries(skill, frameworks, 'kahlan/kahlan', 'Kahlan');
    addFromLibraries(skill, frameworks, 'peridot-php/peridot', 'Peridot');
    addFromLibraries(skill, frameworks, 'phake/phake', 'Phake');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'mockery/mockery', 'Mockery');
    addFromLibraries(skill, libraries, 'php-mock/php-mock', 'PHP-Mock');
    addFromLibraries(skill, libraries, 'php-mock/php-mock-phpunit', 'PHP-Mock PHPUnit');
    addFromLibraries(skill, libraries, 'padraic/mockery', 'Padraic Mockery');
    addFromLibraries(skill, libraries, 'phpspec/prophecy', 'PHPSpec Prophecy');
    addFromLibraries(skill, libraries, 'phpunit/php-invoker', 'PHPUnit Invoker');
    addFromLibraries(skill, libraries, 'phpunit/php-token-stream', 'PHPUnit Token Stream');
    addFromLibraries(skill, libraries, 'phpunit/php-code-coverage', 'PHPUnit Code Coverage');
    addFromLibraries(skill, libraries, 'phpunit/php-timer', 'PHPUnit Timer');
    addFromLibraries(skill, libraries, 'phpunit/php-text-template', 'PHPUnit Text Template');
    return libraries;
  }
}

class CSharpProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = 'csharp';

  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'Microsoft.NETCore.App', '.NET Core');
    addFromLibraries(skill, frameworks, 'Microsoft.AspNetCore.App', 'ASP.NET Core');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'EntityFramework', 'Entity Framework');
    addFromLibraries(skill, libraries, 'Newtonsoft.Json', 'Newtonsoft.Json');
    addFromLibraries(skill, libraries, 'AutoMapper', 'AutoMapper');
    addFromLibraries(skill, libraries, 'Serilog', 'Serilog');
    addFromLibraries(skill, libraries, 'Dapper', 'Dapper');
    addFromLibraries(skill, libraries, 'Polly', 'Polly');
    addFromLibraries(skill, libraries, 'FluentValidation', 'FluentValidation');
    addFromLibraries(skill, libraries, 'MediatR', 'MediatR');
    addFromLibraries(skill, libraries, 'Hangfire', 'Hangfire');
    addFromLibraries(skill, libraries, 'RabbitMQ.Client', 'RabbitMQ.Client');
    addFromLibraries(skill, libraries, 'MassTransit', 'MassTransit');
    addFromLibraries(skill, libraries, 'Microsoft.Extensions.Logging', 'Microsoft.Extensions.Logging');
    addFromLibraries(
      skill,
      libraries,
      'Microsoft.Extensions.DependencyInjection',
      'Microsoft.Extensions.DependencyInjection'
    );
    addFromLibraries(skill, libraries, 'Microsoft.Extensions.Configuration', 'Microsoft.Extensions.Configuration');
    addFromLibraries(skill, libraries, 'Microsoft.Extensions.Http', 'Microsoft.Extensions.Http');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'xunit', 'xUnit');
    addFromLibraries(skill, frameworks, 'NUnit', 'NUnit');
    addFromLibraries(skill, frameworks, 'SpecFlow', 'SpecFlow');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'Moq', 'Moq');
    addFromLibraries(skill, libraries, 'FluentAssertions', 'FluentAssertions');
    addFromLibraries(skill, libraries, 'Bogus', 'Bogus');
    addFromLibraries(skill, libraries, 'RestSharp', 'RestSharp');
    addFromLibraries(skill, libraries, 'Swashbuckle.AspNetCore', 'Swashbuckle.AspNetCore');
    return libraries;
  }
}

class DartProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = 'dart';
  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'flutter', 'Flutter');
    addFromLibraries(skill, frameworks, 'angular', 'AngularDart');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'dartx', 'dartx');
    addFromLibraries(skill, libraries, 'provider', 'Provider');
    addFromLibraries(skill, libraries, 'rxdart', 'RxDart');
    addFromLibraries(skill, libraries, 'dio', 'Dio');
    addFromLibraries(skill, libraries, 'json_serializable', 'json_serializable');
    addFromLibraries(skill, libraries, 'freezed', 'Freezed');
    addFromLibraries(skill, libraries, 'moor', 'Moor');
    addFromLibraries(skill, libraries, 'hive', 'Hive');
    addFromLibraries(skill, libraries, 'http', 'http');
    addFromLibraries(skill, libraries, 'path', 'path');
    addFromLibraries(skill, libraries, 'intl', 'intl');
    addFromLibraries(skill, libraries, 'equatable', 'equatable');
    addFromLibraries(skill, libraries, 'get_it', 'get_it');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'test', 'test');
    addFromLibraries(skill, frameworks, 'flutter_test', 'flutter_test');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'mockito', 'mockito');
    addFromLibraries(skill, libraries, 'bloc_test', 'bloc_test');
    return libraries;
  }
}

class RubyProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = 'ruby';
  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'rails', 'Rails');
    addFromLibraries(skill, frameworks, 'sinatra', 'Sinatra');
    addFromLibraries(skill, frameworks, 'hanami', 'Hanami');
    addFromLibraries(skill, frameworks, 'grape', 'Grape');
    addFromLibraries(skill, frameworks, 'roda', 'Roda');
    addFromLibraries(skill, frameworks, 'padrino', 'Padrino');
    addFromLibraries(skill, frameworks, 'cuba', 'Cuba');
    addFromLibraries(skill, frameworks, 'ramaze', 'Ramaze');
    addFromLibraries(skill, frameworks, 'nyara', 'Nyara');
    addFromLibraries(skill, frameworks, 'rack', 'Rack');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'active_record', 'ActiveRecord');
    addFromLibraries(skill, libraries, 'sequel', 'Sequel');
    addFromLibraries(skill, libraries, 'rom', 'ROM');
    addFromLibraries(skill, libraries, 'datamapper', 'DataMapper');
    addFromLibraries(skill, libraries, 'mongoid', 'Mongoid');
    addFromLibraries(skill, libraries, 'neo4j', 'Neo4j');
    addFromLibraries(skill, libraries, 'redis', 'Redis');
    addFromLibraries(skill, libraries, 'cassandra', 'Cassandra');
    addFromLibraries(skill, libraries, 'couchrest', 'CouchRest');
    addFromLibraries(skill, libraries, 'riak', 'Riak');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'rspec', 'RSpec');
    addFromLibraries(skill, frameworks, 'minitest', 'Minitest');
    addFromLibraries(skill, frameworks, 'cucumber', 'Cucumber');
    addFromLibraries(skill, frameworks, 'spinach', 'Spinach');
    addFromLibraries(skill, frameworks, 'turnip', 'Turnip');
    addFromLibraries(skill, frameworks, 'bacon', 'Bacon');
    addFromLibraries(skill, frameworks, 'shoulda', 'Shoulda');
    addFromLibraries(skill, frameworks, 'test-unit', 'Test::Unit');
    addFromLibraries(skill, frameworks, 'wrong', 'Wrong');
    addFromLibraries(skill, frameworks, 'contest', 'Contest');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'factory_bot', 'FactoryBot');
    addFromLibraries(skill, libraries, 'faker', 'Faker');
    addFromLibraries(skill, libraries, 'ffaker', 'FFaker');
    addFromLibraries(skill, libraries, 'fabrication', 'Fabrication');
    addFromLibraries(skill, libraries, 'machinist', 'Machinist');
    addFromLibraries(skill, libraries, 'mocha', 'Mocha');
    addFromLibraries(skill, libraries, 'flexmock', 'FlexMock');
    addFromLibraries(skill, libraries, 'rr', 'RR');
    addFromLibraries(skill, libraries, 'bourne', 'Bourne');
    addFromLibraries(skill, libraries, 'not_a_mock', 'NotAMock');
    return libraries;
  }
}

class RustProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = 'rust';
  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools;
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];
    addFromLibraries(skill, frameworks, 'tokio', 'tokio');
    addFromLibraries(skill, frameworks, 'async-std', 'async-std');
    addFromLibraries(skill, frameworks, 'hyper', 'hyper');
    addFromLibraries(skill, frameworks, 'actix-web', 'actix-web');
    addFromLibraries(skill, frameworks, 'rocket', 'rocket');
    return frameworks;
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];
    addFromLibraries(skill, libraries, 'serde', 'serde');
    addFromLibraries(skill, libraries, 'regex', 'regex');
    addFromLibraries(skill, libraries, 'rand', 'rand');
    addFromLibraries(skill, libraries, 'log', 'log');
    addFromLibraries(skill, libraries, 'lazy_static', 'lazy_static');
    addFromLibraries(skill, libraries, 'libc', 'libc');
    addFromLibraries(skill, libraries, 'futures', 'futures');
    addFromLibraries(skill, libraries, 'rayon', 'rayon');
    addFromLibraries(skill, libraries, 'reqwest', 'reqwest');
    addFromLibraries(skill, libraries, 'warp', 'warp');
    return libraries;
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    let frameworks: Dependency[] = [];

    addFromLibraries(skill, frameworks, 'test-case', 'test-case');
    addFromLibraries(skill, frameworks, 'proptest', 'proptest');
    addFromLibraries(skill, frameworks, 'quickcheck', 'quickcheck');
    return frameworks;
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    let libraries: Dependency[] = [];

    addFromLibraries(skill, libraries, 'mockall', 'mockall');
    addFromLibraries(skill, libraries, 'double', 'double');
    addFromLibraries(skill, libraries, 'rstest', 'rstest');
    addFromLibraries(skill, libraries, 'mockiato', 'mockiato');
    addFromLibraries(skill, libraries, 'mock_derive', 'mock_derive');
    addFromLibraries(skill, libraries, 'mocktopus', 'mocktopus');
    addFromLibraries(skill, libraries, 'mockers', 'mockers');
    addFromLibraries(skill, libraries, 'mock_it', 'mock_it');
    return libraries;
  }
}

class CProjectMetadataLookup implements IProjectMetadataLookup {
  languageId = ['c', 'cpp'];

  determineBuildTools(skill: ProjectMetadata) {
    return skill.buildTools.filter((tool) =>
      ['gcc', 'clang', 'make', 'cmake', 'autotools', 'ninja', 'meson'].includes(tool.name)
    );
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    return skill.libraries.filter((lib) =>
      ['libc', 'libuv', 'openssl', 'zlib', 'libevent', 'libcurl'].includes(lib.name)
    );
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    return skill.libraries.filter((lib) =>
      ['libpng', 'libjpeg', 'libxml2', 'sqlite', 'postgres', 'mysql'].includes(lib.name)
    );
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    return skill.libraries.filter((lib) =>
      ['unity', 'criterion', 'cmocka', 'check', 'ctest', 'minunit'].includes(lib.name)
    );
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    return skill.libraries.filter((lib) => ['cmock', 'fff', 'trompeloeil', 'fakeit'].includes(lib.name));
  }
}

class CompositeProjectMetadataLookup implements IProjectMetadataLookup {
  languageId: string | string[];
  private delegates: IProjectMetadataLookup[];
  constructor(languageId: string | string[], delegates: IProjectMetadataLookup[]) {
    this.languageId = languageId;
    this.delegates = delegates;
  }
  determineBuildTools(skill: ProjectMetadata) {
    return this.delegates.map((d) => d.determineBuildTools(skill)).flat();
  }
  determineApplicationFrameworks(skill: ProjectMetadata) {
    return this.delegates.map((d) => d.determineApplicationFrameworks(skill)).flat();
  }
  determineCoreLibraries(skill: ProjectMetadata) {
    return this.delegates.map((d) => d.determineCoreLibraries(skill)).flat();
  }
  determineTestingFrameworks(skill: ProjectMetadata) {
    return this.delegates.map((d) => d.determineTestingFrameworks(skill)).flat();
  }
  determineTestingLibraries(skill: ProjectMetadata) {
    return this.delegates.map((d) => d.determineTestingLibraries(skill)).flat();
  }
}

export {
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
};
