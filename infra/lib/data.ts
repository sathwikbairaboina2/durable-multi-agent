import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface DataProps { readonly stage: 'aws' | 'local' }

/** The four tables. Runs holds task tokens, so it gets a customer-managed key (ADR 0004). */
export class Data extends Construct {
  readonly key: kms.Key;
  readonly runs: dynamodb.Table;
  readonly catalog: dynamodb.Table;
  readonly budgets: dynamodb.Table;
  readonly ledger: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataProps) {
    super(scope, id);
    const removalPolicy = props.stage === 'aws' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.key = new kms.Key(this, 'RunsKey', {
      enableKeyRotation: true,
      description: 'Encrypts the Runs table, which stores Step Functions task tokens',
      removalPolicy,
    });

    const table = (name: string, extra: Partial<dynamodb.TableProps> = {}) =>
      new dynamodb.Table(this, name, {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        removalPolicy,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        ...extra,
      });

    this.runs = table('RunsTable', {
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.key,
      timeToLiveAttribute: 'ttl',
    });
    this.catalog = table('CatalogTable');
    this.budgets = table('BudgetsTable');
    this.ledger = table('LedgerTable');
  }
}
