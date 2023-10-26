/**
 * External dependencies
 */
import { MouseEvent } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	Notice,
	Spinner,
	Tooltip,
} from '@wordpress/components';
import {
	EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME,
	Product,
	ProductVariation,
} from '@woocommerce/data';
import { recordEvent } from '@woocommerce/tracks';
import { ListItem, Sortable, Tag } from '@woocommerce/components';
import { getNewPath, navigateTo } from '@woocommerce/navigation';
import {
	useContext,
	useState,
	createElement,
	useRef,
	useMemo,
	Fragment,
	forwardRef,
} from '@wordpress/element';
import { useSelect, useDispatch, resolveSelect } from '@wordpress/data';
import classnames from 'classnames';
import truncate from 'lodash/truncate';
import { CurrencyContext } from '@woocommerce/currency';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore No types for this exist yet.
// eslint-disable-next-line @woocommerce/dependency-group
import { useEntityId, useEntityProp } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import { getProductStockStatus, getProductStockStatusClass } from '../../utils';
import {
	DEFAULT_VARIATION_PER_PAGE_OPTION,
	PRODUCT_VARIATION_TITLE_LIMIT,
	TRACKS_SOURCE,
} from '../../constants';
import { VariationActionsMenu } from './variation-actions-menu';
import { useSelection } from '../../hooks/use-selection';
import { VariationsActionsMenu } from './variations-actions-menu';
import HiddenIcon from '../../icons/hidden-icon';
import { Pagination } from './pagination';
import { EmptyTableState } from './table-empty-state';
import { useProductVariationsHelper } from '../../hooks/use-product-variations-helper';
import { values } from 'lodash';

const NOT_VISIBLE_TEXT = __( 'Not visible to customers', 'woocommerce' );

type VariationsTableProps = {
	noticeText?: string;
	noticeStatus?: 'error' | 'warning' | 'success' | 'info';
	onNoticeDismiss?: () => void;
	noticeActions?: {
		label: string;
		onClick: (
			handleUpdateAll: ( update: Partial< ProductVariation >[] ) => void,
			handleDeleteAll: ( update: Partial< ProductVariation >[] ) => void
		) => void;
		className?: string;
		variant?: string;
	}[];
	onVariationTableChange?: (
		type: 'update' | 'delete',
		updates?: Partial< ProductVariation >[]
	) => void;
};

type VariationResponseProps = {
	update?: Partial< ProductVariation >[];
	delete?: Partial< ProductVariation >[];
};

function getEditVariationLink( variation: ProductVariation ) {
	return getNewPath(
		{},
		`/product/${ variation.parent_id }/variation/${ variation.id }`,
		{}
	);
}

export const VariationsTable = forwardRef<
	HTMLDivElement,
	VariationsTableProps
>( function Table(
	{
		noticeText,
		noticeActions = [],
		noticeStatus = 'error',
		onNoticeDismiss = () => {},
		onVariationTableChange = () => {},
	}: VariationsTableProps,
	ref
) {
	const [ currentPage, setCurrentPage ] = useState( 1 );
	const lastVariations = useRef< ProductVariation[] | null >( null );
	const [ perPage, setPerPage ] = useState(
		DEFAULT_VARIATION_PER_PAGE_OPTION
	);
	const [ isUpdating, setIsUpdating ] = useState< Record< string, boolean > >(
		{}
	);
	const {
		selectedItems,
		areAllSelected,
		isSelected,
		hasSelection,
		onSelectAll,
		onSelectItem,
		onClearSelection,
	} = useSelection< ProductVariation >( {
		getId( item ) {
			return String( item.id );
		},
	} );

	const productId = useEntityId( 'postType', 'product' );
	const requestParams = useMemo(
		() => ( {
			product_id: productId,
			page: currentPage,
			per_page: perPage,
			order: 'asc',
			orderby: 'menu_order',
		} ),
		[ productId, currentPage, perPage ]
	);

	const context = useContext( CurrencyContext );
	const { formatAmount } = context;
	const { isLoading, latestVariations, isGeneratingVariations, totalCount } =
		useSelect(
			( select ) => {
				const {
					getProductVariations,
					getProductVariationsTotalCount,
					hasFinishedResolution,
					isGeneratingVariations: getIsGeneratingVariations,
				} = select( EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME );
				return {
					isLoading: ! hasFinishedResolution(
						'getProductVariations',
						[ requestParams ]
					),
					isGeneratingVariations: getIsGeneratingVariations( {
						product_id: requestParams.product_id,
					} ),
					latestVariations:
						getProductVariations< ProductVariation[] >(
							requestParams
						),
					totalCount:
						getProductVariationsTotalCount< number >(
							requestParams
						),
				};
			},
			[ requestParams ]
		);

	const {
		updateProductVariation,
		deleteProductVariation,
		batchUpdateProductVariations,
		invalidateResolutionForStore,
	} = useDispatch( EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME );
	const { invalidateResolution: coreInvalidateResolution } =
		useDispatch( 'core' );

	const { generateProductVariations } = useProductVariationsHelper();

	const [ productAttributes ] = useEntityProp< Product[ 'attributes' ] >(
		'postType',
		'product',
		'attributes'
	);

	const { createSuccessNotice, createErrorNotice } =
		useDispatch( 'core/notices' );

	if ( latestVariations && latestVariations !== lastVariations.current ) {
		lastVariations.current = latestVariations;
	}

	if ( isLoading && lastVariations.current === null ) {
		return (
			<div className="woocommerce-product-variations__loading">
				<Spinner />
				{ isGeneratingVariations && (
					<span>
						{ __( 'Generating variations…', 'woocommerce' ) }
					</span>
				) }
			</div>
		);
	}

	function handleEmptyTableStateActionClick() {
		generateProductVariations( productAttributes );
	}

	if ( ! ( isLoading || isGeneratingVariations ) && totalCount === 0 ) {
		return (
			<EmptyTableState
				onActionClick={ handleEmptyTableStateActionClick }
			/>
		);
	}

	// this prevents a weird jump from happening while changing pages.
	const variations = latestVariations || lastVariations.current;

	function getSnackbarText(
		response: VariationResponseProps | ProductVariation,
		type?: string
	): string {
		if ( 'id' in response ) {
			const action = type === 'update' ? 'updated' : 'deleted';
			return sprintf(
				/* translators: The deleted or updated variations count */
				__( '1 variation %s.', 'woocommerce' ),
				action
			);
		}

		const { update = [], delete: deleted = [] } = response;
		const updatedCount = update.length;
		const deletedCount = deleted.length;

		if ( deletedCount > 0 ) {
			return sprintf(
				/* translators: The deleted variations count */
				__( '%s variations deleted.', 'woocommerce' ),
				deletedCount
			);
		} else if ( updatedCount > 0 ) {
			return sprintf(
				/* translators: The updated variations count */
				__( '%s variations updated.', 'woocommerce' ),
				updatedCount
			);
		}

		return '';
	}

	function handleDeleteVariationClick( variationId: number ) {
		if ( isUpdating[ variationId ] ) return;
		setIsUpdating( ( prevState ) => ( {
			...prevState,
			[ variationId ]: true,
		} ) );
		deleteProductVariation< Promise< ProductVariation > >( {
			product_id: productId,
			id: variationId,
		} )
			.then( ( response: ProductVariation ) => {
				recordEvent( 'product_variations_delete', {
					source: TRACKS_SOURCE,
				} );
				createSuccessNotice( getSnackbarText( response, 'delete' ) );
				coreInvalidateResolution( 'getEntityRecord', [
					'postType',
					'product',
					productId,
				] );
				coreInvalidateResolution( 'getEntityRecord', [
					'postType',
					'product_variation',
					variationId,
				] );
				return invalidateResolutionForStore();
			} )
			.finally( () => {
				setIsUpdating( ( prevState ) => ( {
					...prevState,
					[ variationId ]: false,
				} ) );
				onVariationTableChange( 'delete' );
			} );

		recordEvent( 'product_variations_delete', {
			source: TRACKS_SOURCE,
			product_id: productId,
			variation_id: variationId,
		} );
	}

	function handleVariationChange(
		variationId: number,
		variation: Partial< ProductVariation >
	) {
		if ( isUpdating[ variationId ] ) return;
		setIsUpdating( ( prevState ) => ( {
			...prevState,
			[ variationId ]: true,
		} ) );
		updateProductVariation< Promise< ProductVariation > >(
			{ product_id: productId, id: variationId },
			variation
		)
			.then( ( response: ProductVariation ) => {
				createSuccessNotice( getSnackbarText( response, 'update' ) );
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to save variation.', 'woocommerce' )
				);
			} )
			.finally( () => {
				setIsUpdating( ( prevState ) => ( {
					...prevState,
					[ variationId ]: false,
				} ) );
				onVariationTableChange( 'update', [ variation ] );
			} );

		recordEvent( 'product_variations_change', {
			source: TRACKS_SOURCE,
			product_id: productId,
			variation_id: variationId,
		} );
	}

	function handleUpdateAll( update: Partial< ProductVariation >[] ) {
		const now = Date.now();

		batchUpdateProductVariations< { update: [] } >(
			{ product_id: productId },
			{ update }
		)
			.then( ( response: VariationResponseProps ) => {
				createSuccessNotice( getSnackbarText( response ) );
				onVariationTableChange( 'update', update );
				return invalidateResolutionForStore();
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to update variations.', 'woocommerce' )
				);
			} )
			.finally( () => {
				recordEvent( 'product_variations_update_all', {
					source: TRACKS_SOURCE,
					product_id: productId,
					variations_count: values.length,
					request_time: Date.now() - now,
				} );
			} );
	}

	function handleDeleteAll( values: Partial< ProductVariation >[] ) {
		const now = Date.now();

		batchUpdateProductVariations< { delete: [] } >(
			{ product_id: productId },
			{
				delete: values.map( ( { id } ) => id ),
			}
		)
			.then( ( response: VariationResponseProps ) => {
				invalidateResolutionForStore();
				coreInvalidateResolution( 'getEntityRecord', [
					'postType',
					'product',
					productId,
				] );
				values.forEach( ( { id: variationId } ) => {
					coreInvalidateResolution( 'getEntityRecord', [
						'postType',
						'product_variation',
						variationId,
					] );
				} );
				return response;
			} )
			.then( ( response: VariationResponseProps ) => {
				createSuccessNotice( getSnackbarText( response ) );
				onVariationTableChange( 'delete' );
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to delete variations.', 'woocommerce' )
				);
			} )
			.finally( () => {
				recordEvent( 'product_variations_delete_all', {
					source: TRACKS_SOURCE,
					product_id: productId,
					variations_count: values.length,
					request_time: Date.now() - now,
				} );
			} );
	}

	function editVariationClickHandler( variation: ProductVariation ) {
		const url = getEditVariationLink( variation );

		return function handleEditVariationClick(
			event: MouseEvent< HTMLAnchorElement >
		) {
			event.preventDefault();

			navigateTo( { url } );

			recordEvent( 'product_variations_edit', {
				source: TRACKS_SOURCE,
				product_id: productId,
				variation_id: variation.id,
			} );
		};
	}

	async function handleSelectAllVariations() {
		const { getProductVariations } = resolveSelect(
			EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME
		);

		const now = Date.now();

		const allExistingVariations = await getProductVariations<
			ProductVariation[]
		>( {
			product_id: productId,
			per_page: 100,
		} );

		onSelectAll( allExistingVariations )( true );

		recordEvent( 'product_variations_select_all', {
			source: TRACKS_SOURCE,
			product_id: productId,
			variations_count: allExistingVariations.length,
			request_time: Date.now() - now,
		} );
	}

	return (
		<div className="woocommerce-product-variations" ref={ ref }>
			{ ( isLoading || isGeneratingVariations ) && (
				<div className="woocommerce-product-variations__loading">
					<Spinner />
					{ isGeneratingVariations && (
						<span>
							{ __( 'Generating variations…', 'woocommerce' ) }
						</span>
					) }
				</div>
			) }
			{ noticeText && (
				<Notice
					status={ noticeStatus }
					className="woocommerce-product-variations__notice"
					onRemove={ onNoticeDismiss }
					actions={ noticeActions.map( ( action ) => ( {
						...action,
						onClick: () => {
							action?.onClick( handleUpdateAll, handleDeleteAll );
						},
					} ) ) }
				>
					{ noticeText }
				</Notice>
			) }

			{ totalCount > 0 && (
				<div className="woocommerce-product-variations__header">
					<div className="woocommerce-product-variations__selection">
						<CheckboxControl
							value="all"
							checked={ areAllSelected( variations ) }
							// @ts-expect-error Property 'indeterminate' does not exist
							indeterminate={
								! areAllSelected( variations ) &&
								hasSelection( variations )
							}
							onChange={ onSelectAll( variations ) }
						/>
					</div>
					<div className="woocommerce-product-variations__filters">
						{ hasSelection( variations ) && (
							<>
								<span>
									{ sprintf(
										// translators: %d is the amount of selected variations
										__( '%d selected', 'woocommerce' ),
										selectedItems.length
									) }
								</span>
								<Button
									variant="tertiary"
									onClick={ () =>
										onSelectAll( variations )( true )
									}
								>
									{ sprintf(
										// translators: %d the variations amount in the current page
										__( 'Select page (%d)', 'woocommerce' ),
										variations.length
									) }
								</Button>
								<Button
									variant="tertiary"
									onClick={ handleSelectAllVariations }
								>
									{ sprintf(
										// translators: %d the total existing variations amount
										__( 'Select all (%d)', 'woocommerce' ),
										totalCount
									) }
								</Button>
								<Button
									variant="tertiary"
									onClick={ onClearSelection }
								>
									{ __( 'Clear selection', 'woocommerce' ) }
								</Button>
							</>
						) }
					</div>
					<div>
						<VariationsActionsMenu
							selection={ selectedItems }
							disabled={ ! hasSelection( variations ) }
							onChange={ handleUpdateAll }
							onDelete={ handleDeleteAll }
						/>
					</div>
				</div>
			) }

			<Sortable className="woocommerce-product-variations__table">
				{ variations.map( ( variation ) => (
					<ListItem key={ `${ variation.id }` }>
						<div className="woocommerce-product-variations__selection">
							<CheckboxControl
								value={ variation.id }
								checked={ isSelected( variation ) }
								onChange={ onSelectItem( variation ) }
							/>
						</div>
						<div className="woocommerce-product-variations__attributes">
							{ variation.attributes.map( ( attribute ) => {
								const tag = (
									/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
									/* @ts-ignore Additional props are not required. */
									<Tag
										id={ attribute.id }
										className="woocommerce-product-variations__attribute"
										key={ attribute.id }
										label={ truncate( attribute.option, {
											length: PRODUCT_VARIATION_TITLE_LIMIT,
										} ) }
										screenReaderLabel={ attribute.option }
									/>
								);

								return attribute.option.length <=
									PRODUCT_VARIATION_TITLE_LIMIT ? (
									tag
								) : (
									<Tooltip
										key={ attribute.id }
										text={ attribute.option }
										position="top center"
									>
										<span>{ tag }</span>
									</Tooltip>
								);
							} ) }
						</div>
						<div
							className={ classnames(
								'woocommerce-product-variations__price',
								{
									'woocommerce-product-variations__price--fade':
										variation.status === 'private',
								}
							) }
						>
							{ variation.on_sale && (
								<span className="woocommerce-product-variations__sale-price">
									{ formatAmount( variation.sale_price ) }
								</span>
							) }
							<span
								className={ classnames(
									'woocommerce-product-variations__regular-price',
									{
										'woocommerce-product-variations__regular-price--on-sale':
											variation.on_sale,
									}
								) }
							>
								{ formatAmount( variation.regular_price ) }
							</span>
						</div>
						<div
							className={ classnames(
								'woocommerce-product-variations__quantity',
								{
									'woocommerce-product-variations__quantity--fade':
										variation.status === 'private',
								}
							) }
						>
							{ variation.regular_price && (
								<>
									<span
										className={ classnames(
											'woocommerce-product-variations__status-dot',
											getProductStockStatusClass(
												variation
											)
										) }
									>
										●
									</span>
									{ getProductStockStatus( variation ) }
								</>
							) }
						</div>
						<div className="woocommerce-product-variations__actions">
							{ ( variation.status === 'private' ||
								! variation.regular_price ) && (
								<Tooltip
									// @ts-expect-error className is missing in TS, should remove this when it is included.
									className="woocommerce-attribute-list-item__actions-tooltip"
									position="top center"
									text={ NOT_VISIBLE_TEXT }
								>
									<div className="woocommerce-attribute-list-item__actions-icon-wrapper">
										<HiddenIcon className="woocommerce-attribute-list-item__actions-icon-wrapper-icon" />
									</div>
								</Tooltip>
							) }

							<Button
								href={ getEditVariationLink( variation ) }
								onClick={ editVariationClickHandler(
									variation
								) }
							>
								{ __( 'Edit', 'woocommerce' ) }
							</Button>

							<VariationActionsMenu
								selection={ variation }
								onChange={ ( value ) =>
									handleVariationChange( variation.id, value )
								}
								onDelete={ ( { id } ) =>
									handleDeleteVariationClick( id )
								}
							/>
						</div>
					</ListItem>
				) ) }
			</Sortable>

			{ totalCount > 5 && (
				<Pagination
					className="woocommerce-product-variations__footer"
					totalCount={ totalCount }
					onPageChange={ setCurrentPage }
					onPerPageChange={ setPerPage }
				/>
			) }
		</div>
	);
} );
