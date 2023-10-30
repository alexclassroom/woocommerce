/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { getNewPath } from '@woocommerce/navigation';
import { createInterpolateElement, useContext } from '@wordpress/element';
import { Icon, external } from '@wordpress/icons';

/**
 * Internal dependencies
 */
import { getAdminSetting } from '../../../utils/admin-settings';
import { SubscriptionsContext } from '../../contexts/subscriptions-context';
import './my-subscriptions.scss';
import {
	AvailableSubscriptionsTable,
	InstalledSubscriptionsTable,
} from './table/table';
import {
	availableSubscriptionRow,
	installedSubscriptionRow,
} from './table/table-rows';
import { Subscription } from './types';
import RefreshIcon from '../../assets/images/refresh.svg';

export default function MySubscriptions(): JSX.Element {
	const { subscriptions, isLoading } = useContext( SubscriptionsContext );
	const wccomSettings = getAdminSetting( 'wccomHelper', {} );

	const updateConnectionUrl = getNewPath(
		{
			page: 'wc-addons',
			section: 'helper',
			filter: 'all',
			'wc-helper-refresh': 1,
			'wc-helper-nonce': getAdminSetting( 'wc_helper_nonces' ).refresh,
			'redirect-to-wc-admin': 1,
		},
		''
	);

	const installedTableDescription = createInterpolateElement(
		__(
			'WooCommerce.com extensions and themes installed on this store. To see all your subscriptions go to <a>your account<custom_icon /></a> on WooCommerce.com.',
			'woocommerce'
		),
		{
			a: (
				<a
					href="https://woocommerce.com/my-account/my-subscriptions"
					target="_blank"
					rel="nofollow noopener noreferrer"
				>
					your account
				</a>
			),
			custom_icon: <Icon icon={ external } size={ 12 } />,
		}
	);

	const subscriptionsInstalled: Array< Subscription > = subscriptions.filter(
		( subscription: Subscription ) => subscription.local.installed
	);

	const subscriptionsAvailable: Array< Subscription > = subscriptions.filter(
		( subscription: Subscription ) =>
			! subscriptionsInstalled.includes( subscription )
	);

	if ( ! wccomSettings?.isConnected ) {
		return (
			<div className="woocommerce-marketplace__my-subscriptions--connect">
				<div className="woocommerce-marketplace__my-subscriptions__icon" />
				<h2 className="woocommerce-marketplace__my-subscriptions__header">
					{ __( 'Manage your subscriptions', 'woocommerce' ) }
				</h2>
				<p className="woocommerce-marketplace__my-subscriptions__description">
					{ __(
						'Connect your account to get updates, manage your subscriptions, and get seamless support. Once connected, your WooCommerce.com subscriptions will appear here.',
						'woocommerce'
					) }
				</p>
				<Button href={ wccomSettings?.connectURL } variant="primary">
					{ __( 'Connect Account', 'woocommerce' ) }
				</Button>
			</div>
		);
	}

	return (
		<div className="woocommerce-marketplace__my-subscriptions">
			<section className="woocommerce-marketplace__my-subscriptions__installed">
				<header className="woocommerce-marketplace__my-subscriptions__header">
					<div>
						<h2 className="woocommerce-marketplace__my-subscriptions__heading">
							{ __( 'Installed on this store', 'woocommerce' ) }
						</h2>
						<span className="woocommerce-marketplace__my-subscriptions__table-description">
							{ installedTableDescription }
						</span>
					</div>
					<div>
						<Button
							href={ updateConnectionUrl }
							className="woocommerce-marketplace__refresh-subscriptions"
						>
							<img
								src={ RefreshIcon }
								alt="Refresh subscriptions"
							/>
							{ __( 'Refresh', 'woocommerce' ) }
						</Button>
					</div>
				</header>
				<InstalledSubscriptionsTable
					isLoading={ isLoading }
					rows={ subscriptionsInstalled.map( ( item ) => {
						return installedSubscriptionRow( item );
					} ) }
				/>
			</section>

			<section className="woocommerce-marketplace__my-subscriptions__available">
				<h2 className="woocommerce-marketplace__my-subscriptions__heading">
					{ __( 'Available to use', 'woocommerce' ) }
				</h2>
				<p className="woocommerce-marketplace__my-subscriptions__table-description">
					{ __(
						"WooCommerce.com subscriptions you haven't used yet.",
						'woocommerce'
					) }
				</p>
				<AvailableSubscriptionsTable
					isLoading={ isLoading }
					rows={ subscriptionsAvailable.map( ( item ) => {
						return availableSubscriptionRow( item );
					} ) }
				/>
			</section>
		</div>
	);
}
